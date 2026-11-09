package tv.stark.app

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread

/**
 * Live "timeshift" buffer.
 *
 * Reads a channel's MPEG-TS stream from the provider, cuts it into short segments at keyframes and keeps the last
 * few minutes on disk, published as a growing HLS playlist. ExoPlayer plays that playlist, which gives:
 *  - a safety delay behind live (drops in the stream are bridged while this reconnects in the background),
 *  - pause, rewind and fast-forward within the kept window.
 * Reconnects on its own; each reconnect is marked as a discontinuity in the playlist.
 */
class TimeshiftRecorder(
    private val url: String,
    private val userAgent: String,
    private val dir: File,
    private val keepMs: Long,
    private val log: (String) -> Unit
) {
    class Seg(val seq: Long, val file: File, val durMs: Long, val pdtMs: Long, val disc: Boolean)

    private val lock = Any()
    private val segs = ArrayDeque<Seg>()
    private var discSeqBase = 0L          // EXT-X-DISCONTINUITY-SEQUENCE
    private var nextSeq = 0L

    @Volatile var running = true
        private set
    @Volatile var lastHttpCode = 0
        private set
    @Volatile var everConnected = false
        private set
    @Volatile private var conn: HttpURLConnection? = null
    private val started = System.currentTimeMillis()

    fun start() = thread(name = "starktv-timeshift", isDaemon = true) { loop() }

    fun stop() {
        running = false
        try { conn?.disconnect() } catch (_: Exception) {}
    }

    fun segmentCount(): Int = synchronized(lock) { segs.size }

    /* ---------------- connection health ---------------- */
    // every finished segment: [wall-clock ms when it arrived, bytes, ms of programme in it]
    private val netLog = ArrayDeque<LongArray>()

    /**
     * How well the line keeps up, over the last ~20 s: kbps arriving, kbps the channel needs, and the speed
     * factor (seconds of programme received per second – below 1.0 the buffer drains and it will stall).
     * Null until there's enough to judge.
     */
    fun netStats(): LongArray? { synchronized(lock) {
        val now = System.currentTimeMillis()
        while (netLog.isNotEmpty() && now - netLog.first()[0] > 20000) netLog.removeFirst()
        if (netLog.size < 2) return null
        val first = netLog.first()
        val span = (now - first[0] + first[2]).coerceIn(1000L, 20000L)
        if (now - started < 8000) return null
        var bytes = 0L; var media = 0L
        for (e in netLog) { bytes += e[1]; media += e[2] }
        if (media <= 0) return null
        return longArrayOf(bytes * 8 / span, bytes * 8 / media, media * 1000 / span)    // kbps in, kbps needed, factor ×1000
    } }

    /** Recording has produced nothing for this long (ms) – used to report a dead channel. */
    fun silentForMs(): Long = synchronized(lock) {
        val last = segs.lastOrNull() ?: return System.currentTimeMillis() - started
        System.currentTimeMillis() - (last.pdtMs + last.durMs)
    }

    fun segmentFile(name: String): File? = synchronized(lock) { segs.firstOrNull { it.file.name == name }?.file }

    fun playlist(): String = synchronized(lock) {
        val sb = StringBuilder()
        val target = maxOf(2L, ((segs.maxOfOrNull { it.durMs } ?: 2000L) + 999) / 1000)
        sb.append("#EXTM3U\n#EXT-X-VERSION:3\n")
        sb.append("#EXT-X-TARGETDURATION:").append(target).append('\n')
        sb.append("#EXT-X-MEDIA-SEQUENCE:").append(segs.firstOrNull()?.seq ?: 0L).append('\n')
        sb.append("#EXT-X-DISCONTINUITY-SEQUENCE:").append(discSeqBase).append('\n')
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        segs.forEachIndexed { i, s ->
            if (s.disc && i > 0) sb.append("#EXT-X-DISCONTINUITY\n")
            sb.append("#EXT-X-PROGRAM-DATE-TIME:").append(fmt.format(Date(s.pdtMs))).append('\n')
            sb.append("#EXTINF:").append(String.format(Locale.US, "%.3f", s.durMs / 1000.0)).append(",\n")
            sb.append(s.file.name).append('\n')
        }
        sb.toString()
    }

    /* ---------------- network ---------------- */

    private fun loop() {
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        var failures = 0
        var disc = false
        while (running) {
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                conn = c
                c.setRequestProperty("User-Agent", userAgent)
                c.connectTimeout = 15000
                c.readTimeout = 20000
                c.instanceFollowRedirects = true
                val code = c.responseCode
                lastHttpCode = code
                if (code != 200) { c.disconnect(); throw IOException("HTTP $code") }
                everConnected = true
                failures = 0
                c.inputStream.use { record(it, disc) }
                if (running) log("timeshift: stream ended, reconnecting")
            } catch (e: Exception) {
                if (!running) break
                failures++
                log("timeshift: ${e.message} (attempt $failures)")
                try { Thread.sleep(minOf(800L * failures, 5000L)) } catch (_: InterruptedException) {}
            } finally {
                try { conn?.disconnect() } catch (_: Exception) {}
            }
            disc = true            // whatever comes next follows a gap
        }
        synchronized(lock) { segs.clear() }
        dir.listFiles()?.forEach { it.delete() }
    }

    /* ---------------- MPEG-TS parsing ---------------- */

    // last video timestamp written – after a reconnect the provider often re-sends the last few seconds; those are skipped
    private var lastWrittenPts = -1L

    private var pat: ByteArray? = null
    private var pmt: ByteArray? = null
    private var pmtPid = -1
    private var videoPid = -1

    private fun record(input: InputStream, discontinuity: Boolean) {
        var disc = discontinuity
        val pkt = ByteArray(188)
        val cur = java.io.ByteArrayOutputStream(4 shl 20)
        var segStartPts = -1L
        var segStartWall = 0L
        var lastPts = -1L
        var havePkt: Int
        // timeline: map PTS to wall-clock so PROGRAM-DATE-TIME runs smoothly across segments
        var basePts = -1L
        var baseWall = 0L
        var videoStarts = 0          // frames seen – a stream with no detectable keyframes falls back to any frame start
        var sawKey = false
        var lastEnd = synchronized(lock) { segs.lastOrNull()?.let { it.pdtMs + it.durMs } ?: 0L }   // PROGRAM-DATE-TIME never goes backwards
        var skipUntil = if (discontinuity) lastWrittenPts else -1L      // drop what we already have (same clock, up to 2 min back)
        var skipped = 0
        var skipPkts = 0

        fun flush(endPts: Long) {
            if (cur.size() == 0 || segStartPts < 0) return
            var dur = if (endPts >= 0) ptsDiffMs(segStartPts, endPts) else System.currentTimeMillis() - segStartWall
            if (dur <= 0 || dur > 30000) dur = maxOf(200L, System.currentTimeMillis() - segStartWall)
            val pdt = maxOf(baseWall + ptsDiffMs(basePts, segStartPts), lastEnd)
            lastEnd = pdt + dur
            val seq = synchronized(lock) { nextSeq++ }
            val f = File(dir, "seg_$seq.ts")
            f.writeBytes(cur.toByteArray())
            synchronized(lock) {
                netLog.addLast(longArrayOf(System.currentTimeMillis(), cur.size().toLong(), dur))
                segs.addLast(Seg(seq, f, dur, pdt, disc))
                // keep only the window: drop the oldest, keeping the discontinuity count right
                var total = segs.sumOf { it.durMs }
                // also give space back if the Stick is running low (keeps at least ~400 MB free)
                while (segs.size > 3 && (total > keepMs || dir.usableSpace < 400L * 1024 * 1024)) {
                    val old = segs.removeFirst()
                    total -= old.durMs
                    if (segs.firstOrNull()?.disc == true) { discSeqBase++; }
                    old.file.delete()
                }
            }
            disc = false
            cur.reset()
        }

        while (running) {
            // read one 188-byte packet, re-syncing on 0x47 if needed
            havePkt = readFully(input, pkt, 0, 1); if (havePkt < 1) break
            if (pkt[0] != 0x47.toByte()) continue
            if (readFully(input, pkt, 1, 187) < 187) break

            val pid = ((pkt[1].toInt() and 0x1F) shl 8) or (pkt[2].toInt() and 0xFF)
            val pusi = (pkt[1].toInt() and 0x40) != 0
            val afc = (pkt[3].toInt() shr 4) and 0x3
            var payload = 4
            var rai = false
            if (afc == 2 || afc == 3) {
                val afLen = pkt[4].toInt() and 0xFF
                if (afLen > 0) rai = (pkt[5].toInt() and 0x40) != 0
                payload = 5 + afLen
            }
            if (afc == 2) payload = 188

            if (pid == 0 && pusi && payload < 188) { pat = pkt.copyOf(); parsePat(pkt, payload); continue }
            if (pid == pmtPid && pusi && payload < 188) { pmt = pkt.copyOf(); parsePmt(pkt, payload); continue }
            if (pat == null || pmt == null || videoPid < 0) continue          // wait until we know the layout

            var pts = -1L
            if (pid == videoPid && pusi && payload + 14 <= 188) pts = pesPts(pkt, payload)
            if (skipUntil >= 0 && ++skipPkts > 60_000) skipUntil = -1       // no timestamps to go on: stop skipping
            if (skipUntil >= 0) {
                if (pts >= 0) {
                    val d = ptsDiffMs(skipUntil, pts)
                    if (d > 0 || d < -120_000) {         // past what we had (or a different clock): record from here
                        if (skipped > 0) log("timeshift: skipped ${skipped} repeated frames after reconnecting")
                        skipUntil = -1
                    } else { skipped++; continue }
                } else continue                          // audio etc. belonging to the repeated part
            }
            // the stream's clock jumped mid-connection
            if (pts >= 0 && lastWrittenPts >= 0 && segStartPts >= 0) {
                val d = ptsDiffMs(lastWrittenPts, pts)
                if (d < -1500 && d > -120_000) {
                    // went back up to 2 minutes: the provider is re-sending a bit we already have – skip it, don't replay it
                    log("timeshift: stream went back ${-d / 1000}s – skipping the repeat")
                    skipUntil = lastWrittenPts; skipped = 1; skipPkts = 0
                    continue
                }
                if (d <= -120_000 || d > 15_000) {
                    // a new clock (channel restarted, ad break from another source…): start a fresh section
                    log("timeshift: stream clock jumped ${d / 1000}s – new section")
                    flush(lastPts); disc = true
                    basePts = -1; segStartPts = -1; lastWrittenPts = -1
                }
            }
            if (pts >= 0) lastPts = pts

            // keyframe = flagged by the stream, or found by looking at the picture data itself (SPS / IDR / sequence header)
            var key = false
            if (pid == videoPid && pusi) {
                videoStarts++
                key = rai || esKeyframe(pkt, payload)
                if (key) sawKey = true
            }
            if (pid == videoPid && pusi) {
                val haveSeg = segStartPts >= 0
                val segMs = if (!haveSeg) 0L else if (pts >= 0) ptsDiffMs(segStartPts, pts) else System.currentTimeMillis() - segStartWall
                val early = synchronized(lock) { segs.size } < 3          // first few segments short = picture appears fast
                val cut = (!haveSeg && (key || (!sawKey && videoStarts > 25))) ||        // first segment starts on a keyframe
                    (haveSeg && key && segMs >= (if (early) 600L else 2000L)) ||           // normally cut at keyframes
                    (haveSeg && segMs >= (if (early) 1500L else 4000L))                     // long gaps between keyframes: don't wait for one
                if (cut) {
                    flush(pts)
                    if (pts >= 0 && basePts < 0) { basePts = pts; baseWall = maxOf(System.currentTimeMillis(), lastEnd) }
                    segStartPts = if (pts >= 0) pts else (lastPts.takeIf { it >= 0 } ?: 0L)
                    if (basePts < 0) { basePts = segStartPts; baseWall = maxOf(System.currentTimeMillis(), lastEnd) }
                    segStartWall = System.currentTimeMillis()
                    pat?.let { cur.write(it) }      // every segment starts with PAT + PMT so it can be played on its own
                    pmt?.let { cur.write(it) }
                }
            }
            if (segStartPts >= 0) { cur.write(pkt); if (pts >= 0 && pid == videoPid) lastWrittenPts = pts }
        }
        flush(lastPts)
    }

    private fun parsePat(p: ByteArray, payload: Int) {
        var i = payload + 1 + (p[payload].toInt() and 0xFF)    // pointer field
        if (i + 8 > 188) return
        val secLen = ((p[i + 1].toInt() and 0x0F) shl 8) or (p[i + 2].toInt() and 0xFF)
        val end = minOf(188, i + 3 + secLen - 4)
        i += 8
        while (i + 4 <= end) {
            val prog = ((p[i].toInt() and 0xFF) shl 8) or (p[i + 1].toInt() and 0xFF)
            val pid = ((p[i + 2].toInt() and 0x1F) shl 8) or (p[i + 3].toInt() and 0xFF)
            if (prog != 0) { if (pmtPid != pid) { pmtPid = pid; pmt = null; videoPid = -1 }; return }
            i += 4
        }
    }

    private fun parsePmt(p: ByteArray, payload: Int) {
        var i = payload + 1 + (p[payload].toInt() and 0xFF)
        if (i + 12 > 188) return
        val secLen = ((p[i + 1].toInt() and 0x0F) shl 8) or (p[i + 2].toInt() and 0xFF)
        val end = minOf(188, i + 3 + secLen - 4)
        val progInfoLen = ((p[i + 10].toInt() and 0x0F) shl 8) or (p[i + 11].toInt() and 0xFF)
        i += 12 + progInfoLen
        var firstPid = -1
        while (i + 5 <= end) {
            val type = p[i].toInt() and 0xFF
            val pid = ((p[i + 1].toInt() and 0x1F) shl 8) or (p[i + 2].toInt() and 0xFF)
            val esLen = ((p[i + 3].toInt() and 0x0F) shl 8) or (p[i + 4].toInt() and 0xFF)
            if (firstPid < 0) firstPid = pid
            if (type == 0x1B || type == 0x24 || type == 0x02 || type == 0x01 || type == 0x10) { videoPid = pid; videoType = type; return }
            i += 5 + esLen
        }
        if (videoPid < 0) videoPid = firstPid       // radio / unusual streams: cut on the first stream instead
    }

    private var videoType = 0

    /** Does this frame start with a keyframe? Looks for H.264 IDR/SPS, HEVC IRAP/VPS/SPS or an MPEG-2 sequence header. */
    private fun esKeyframe(p: ByteArray, o: Int): Boolean {
        if (o + 9 >= 188 || p[o].toInt() != 0 || p[o + 1].toInt() != 0 || p[o + 2].toInt() != 1) return false
        var i = o + 9 + (p[o + 8].toInt() and 0xFF)
        while (i + 3 < 188) {
            if (p[i].toInt() == 0 && p[i + 1].toInt() == 0 && p[i + 2].toInt() == 1) {
                val b = p[i + 3].toInt() and 0xFF
                when (videoType) {
                    0x1B -> { val t = b and 0x1F; if (t == 5 || t == 7) return true }
                    0x24 -> { val t = (b shr 1) and 0x3F; if (t in 16..21 || t == 32 || t == 33) return true }
                    0x01, 0x02 -> if (b == 0xB3) return true
                }
                i += 3
            } else i++
        }
        return false
    }

    private fun pesPts(p: ByteArray, o: Int): Long {
        if (p[o].toInt() != 0 || p[o + 1].toInt() != 0 || p[o + 2].toInt() != 1) return -1
        val flags = (p[o + 7].toInt() and 0xC0) shr 6
        if (flags < 2) return -1
        val b = o + 9
        return (((p[b].toLong() and 0x0E) shl 29) or ((p[b + 1].toLong() and 0xFF) shl 22) or
            ((p[b + 2].toLong() and 0xFE) shl 14) or ((p[b + 3].toLong() and 0xFF) shl 7) or
            ((p[b + 4].toLong() and 0xFE) shr 1))
    }

    /** PTS difference in ms, handling the 33-bit wrap. */
    private fun ptsDiffMs(from: Long, to: Long): Long {
        if (from < 0 || to < 0) return 0
        var d = to - from
        if (d < -(1L shl 32)) d += (1L shl 33)
        return d / 90
    }

    private fun readFully(input: InputStream, b: ByteArray, off: Int, len: Int): Int {
        var n = 0
        while (n < len) {
            val r = input.read(b, off + n, len - n)
            if (r < 0) return n
            n += r
        }
        return n
    }
}
