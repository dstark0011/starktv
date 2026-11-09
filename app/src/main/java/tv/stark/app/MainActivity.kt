package tv.stark.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.content.pm.PackageInstaller
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import android.app.UiModeManager
import android.content.pm.PackageManager
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.content.Context
import android.content.Intent
import android.speech.RecognizerIntent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLivePlaybackSpeedControl
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.common.Format
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.io.File

/**
 * StarkTV for Android TV / Fire TV.
 * The interface is the same HTML/JS app as the PC version (in assets/web), running in a WebView.
 * Video plays in a native Media3 (ExoPlayer) view laid over the page's player area, or full screen.
 */
@OptIn(UnstableApi::class)
class MainActivity : Activity() {

    companion object {
        const val UA = "VLC/3.0.20 LibVLC/3.0.20"    // many IPTV panels only answer player-style user agents
        const val BG = "#13202b"
        const val MATCH = FrameLayout.LayoutParams.MATCH_PARENT
    }

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var playerView: PlayerView
    private var player: ExoPlayer? = null
    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("starktv", Context.MODE_PRIVATE) }

    private var fullscreen = false
    private var tvDevice = true                 // false on phones / tablets
    private var wantVisible = false
    private var currentUrl: String? = null
    private var retries = 0
    private var bounds: JSONObject? = null
    private var lastBack = 0L
    @Volatile private var lastStatus = "{\"state\":\"idle\"}"

    // live timeshift (safety delay, pause, rewind, fast-forward)
    @Volatile private var recorder: TimeshiftRecorder? = null
    private var recGen = 0
    private var delayMs = 15000L            // Settings → Live delay
    private var keepMs = 30 * 60_000L       // Settings → Pause & rewind up to
    private var trick = 0                   // <0 rewinding, >0 fast-forwarding (×speed)
    private var trickPos = 0L               // where rewind/fast-forward has got to (kept separately so it never snaps back)
    // lets the live delay grow while watching (slow-internet buffer switched on mid-programme)
    private val liveSpeed = DefaultLivePlaybackSpeedControl.Builder().build()
    private var startAtMs = 0L
    @Volatile private var tracksJson = "{\"text\":[],\"audio\":[]}"
    private var subsOn = false                     // Settings → Subtitles (off unless you pick one)

    /** subtitle + audio choices on what's playing, for the page's CC menu */
    private fun describeTracks(t: Tracks): String {
        val text = org.json.JSONArray(); val audio = org.json.JSONArray()
        t.groups.forEachIndexed { gi, g ->
            for (ti in 0 until g.length) {
                if (!g.isTrackSupported(ti)) continue
                val f = g.getTrackFormat(ti)
                val name = listOfNotNull(f.label, f.language?.let { java.util.Locale(it).displayLanguage.takeIf { d -> d.isNotBlank() } ?: it }).distinct().joinToString(" · ").ifBlank { "Track ${ti + 1}" }
                val o = JSONObject().put("g", gi).put("t", ti).put("name", name).put("sel", g.isTrackSelected(ti))
                when (g.type) { C.TRACK_TYPE_TEXT -> text.put(o); C.TRACK_TYPE_AUDIO -> audio.put(o) }
            }
        }
        val textOff = player?.trackSelectionParameters?.disabledTrackTypes?.contains(C.TRACK_TYPE_TEXT) == true
        return JSONObject().put("text", text).put("audio", audio).put("textOff", textOff).toString()
    }

    private fun applySubsDefault(p: ExoPlayer) {
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !subsOn).build()
    }

    /** pick a subtitle (g < 0 = off) or audio track */
    private fun chooseTrack(kind: String, g: Int, t: Int) {
        val p = player ?: return
        val b = p.trackSelectionParameters.buildUpon()
        if (kind == "text" && g < 0) b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        else {
            val group = p.currentTracks.groups.getOrNull(g) ?: return
            if (kind == "text") b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            b.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, t))
        }
        p.trackSelectionParameters = b.build()
        main.postDelayed({ tracksJson = describeTracks(p.currentTracks) }, 300)
    }                    // resume point for the next film / episode
    private val stalls = ArrayDeque<Long>()      // when playback had to stop and wait for the internet
    private var wasReady = false
    private var playHeldDown = 0L
    private var playLongDone = false
    private val usingTimeshift get() = recorder != null

    private val isLive: Boolean
        get() {
            val u = currentUrl ?: return false
            return !(u.contains("/movie/") || u.contains("/series/") ||
                Regex("\\.(mp4|mkv|avi|mov|webm|m4v)(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(u))
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        tvDevice = detectTv()
        if (!tvDevice) {
            // phones: any orientation (portrait layout), and the page shrinks above the keyboard instead of being covered
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
            @Suppress("DEPRECATION")
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        } else requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE

        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor(BG))

        WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        web.setBackgroundColor(Color.TRANSPARENT)       // the video sits underneath and shows through the player area
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = true
        @Suppress("DEPRECATION")
        s.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        s.allowUniversalAccessFromFileURLs = true     // the page talks to your provider directly, like the PC app
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.mediaPlaybackRequiresUserGesture = false
        // TV: lay the page out 1280 wide and scale it to the screen. Phone: lay it out at the phone's real width
        // (decided here, before the page loads – changing it afterwards isn't reliable in Android's WebView)
        s.useWideViewPort = tvDevice
        s.loadWithOverviewMode = tvDevice
        if (!tvDevice) { s.setSupportZoom(false); s.builtInZoomControls = false }
        s.userAgentString = UA
        web.addJavascriptInterface(Bridge(), "AndroidBridge")
        web.webViewClient = WebViewClient()
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) log("console: ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }

        playerView = PlayerView(this)
        playerView.setBackgroundColor(Color.BLACK)
        playerView.useController = false
        playerView.setShowSubtitleButton(true)          // TV films: CC button in the player's own controls
        playerView.isFocusable = false
        playerView.keepScreenOn = true
        playerView.visibility = View.GONE

        root.addView(playerView, FrameLayout.LayoutParams(1, 1))
        root.addView(web, FrameLayout.LayoutParams(MATCH, MATCH))
        setContentView(root)

        web.requestFocus()
        web.loadUrl("file:///android_asset/web/index.html" + if (tvDevice) "" else "?phone=1")
        main.postDelayed(progressTick, 2000)
    }

    /* ---------------- player ---------------- */

    private fun ensurePlayer(): ExoPlayer {
        player?.let { return it }
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(UA)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(20000)
        val extractors = DefaultExtractorsFactory()
            .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES)
        // platform decoders first; FFmpeg steps in for audio the TV can't decode (MP2, AC-3 on some boxes…)
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
            .setEnableDecoderFallback(true)
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(10_000, 50_000, 500, 1_500)     // start after 0.5 s of video (was 2.5 s)
            .build()
        val p = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http, extractors))
            .setLoadControl(load)
            .setLivePlaybackSpeedControl(liveSpeed)
            .build()
        p.setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true
        )
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) { retries = 0; wasReady = true }
                if (state == Player.STATE_BUFFERING && wasReady && player?.playWhenReady == true && trick == 0) {
                    stalls.addLast(System.currentTimeMillis()); while (stalls.size > 50) stalls.removeFirst()
                }
                if (state == Player.STATE_ENDED && isLive) reconnect("stream ended")
                sendState()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) = sendState()

            override fun onTracksChanged(tracks: Tracks) { tracksJson = describeTracks(tracks) }

            override fun onPlayerError(error: PlaybackException) {
                log("player error: ${error.errorCodeName} ${error.message} ${error.cause?.message ?: ""}")
                val p = player
                if (usingTimeshift && p != null && retries < 6) {
                    retries++
                    userSeek()
                    val wasTrick = trick != 0
                    val keep = if (wasTrick) trickPos else p.currentPosition
                    trickStop(resume = false)
                    p.prepare()
                    if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                        p.seekToDefaultPosition()          // paused/rewound past the kept window: the oldest bit has gone
                    } else {
                        // a damaged bit of stream: carry on just past it – never jump back to replay what you've seen
                        p.seekTo(keep + 1000L * retries)
                    }
                    p.playWhenReady = true
                    return
                }
                val code = (error.cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode ?: 0
                if (currentUrl != null && retries < (if (code == 469) 4 else 3)) reconnect(error.errorCodeName)
                else sendState("error", friendly(error, code))
            }
        })
        // for the Playback log: what the picture is, and when the Stick can't keep up decoding it
        p.addAnalyticsListener(object : AnalyticsListener {
            override fun onVideoInputFormatChanged(t: AnalyticsListener.EventTime, f: Format, r: DecoderReuseEvaluation?) {
                log("picture: ${f.sampleMimeType?.substringAfter('/') ?: "?"} ${f.width}x${f.height}${if (f.frameRate > 0) " ${f.frameRate.toInt()}fps" else ""}${if (f.bitrate > 0) " ${f.bitrate / 1000}kbps" else ""}")
            }
            override fun onVideoDecoderInitialized(t: AnalyticsListener.EventTime, name: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
                log("video decoder: $name")
            }
            override fun onDroppedVideoFrames(t: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
                if (droppedFrames >= 25) log("dropped $droppedFrames picture frames in ${elapsedMs / 1000.0}s – the Stick is struggling with this channel")
            }
        })
        playerView.player = p
        player = p
        applySubsDefault(p)
        return p
    }

    private fun startUrl(url: String) {
        val p = ensurePlayer()
        userSeek(); log("play ${url.substringAfterLast('/')}")
        curSpeed = 0f; setSpeed(1f)
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().clearOverrides().build(); applySubsDefault(p)   // each programme starts with your subtitle setting
        wasReady = false
        stopRecorder()
        trickStop(resume = false)
        if (isLive && !url.contains(".m3u8")) { startAtMs = 0; startTimeshift(url); return }
        val from = if (isLive) 0L else startAtMs
        startAtMs = 0
        p.setMediaItem(MediaItem.fromUri(url), from)      // films: start straight at the resume point
        p.prepare()
        p.playWhenReady = true
    }

    /* ---------------- live timeshift ---------------- */

    private fun startTimeshift(url: String) {
        val gen = ++recGen
        val rec = TimeshiftRecorder(url, UA, File(cacheDir, "timeshift"), keepMs) { log(it) }
        recorder = rec
        rec.start()
        sendState("buffering")
        // wait for the first segment, then hand the playlist to the player
        val waitStart = System.currentTimeMillis()
        val check = object : Runnable {
            override fun run() {
                if (gen != recGen || recorder !== rec) return
                if (rec.segmentCount() >= 1) { playTimeshift(rec, gen); return }
                if (System.currentTimeMillis() - waitStart > 20000) {
                    val code = rec.lastHttpCode
                    sendState("error", if (code != 200 && code != 0) friendlyCode(code) else "This channel isn't sending a picture right now.")
                    return
                }
                main.postDelayed(this, 50)
            }
        }
        main.post(check)
    }

    private fun playTimeshift(rec: TimeshiftRecorder, gen: Int) {
        val p = ensurePlayer()
        liveSpeed.setTargetLiveOffsetOverrideUs(C.TIME_UNSET)        // each channel starts from its own settings
        val live = MediaItem.LiveConfiguration.Builder()
            .setTargetOffsetMs(maxOf(delayMs, 3000L))
            .setMinOffsetMs(1500)
            .setMinPlaybackSpeed(0.97f)            // builds the safety delay by playing at 97 %
            .setMaxPlaybackSpeed(if (delayMs <= 3000L) 1.03f else 1.0f)
            .build()
        val item = MediaItem.Builder()
            .setUri("http://starktv.timeshift/$gen/index.m3u8")
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .setLiveConfiguration(live)
            .build()
        val dsf = DataSource.Factory { TimeshiftDataSource { if (recGen == gen) recorder else null } }
        val source = HlsMediaSource.Factory(dsf)
            .setExtractorFactory(DefaultHlsExtractorFactory(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES, true))
            .createMediaSource(item)
        p.setMediaSource(source)
        p.prepare()
        p.playWhenReady = true
        val health = object : Runnable {
            override fun run() {
                if (gen != recGen || recorder !== rec) return
                if (rec.silentForMs() > 25000 && trick == 0 && (player?.playbackState == Player.STATE_BUFFERING)) {
                    val code = rec.lastHttpCode
                    sendState("error", if (code != 200 && code != 0) friendlyCode(code) else "The channel stopped sending – reconnecting…")
                }
                main.postDelayed(this, 3000)
            }
        }
        main.postDelayed(health, 5000)
    }

    private fun stopRecorder() {
        recorder?.stop()
        recorder = null
        recGen++
    }

    /** ms behind real live, or -1 if unknown */
    private fun behindMs(): Long {
        val p = player ?: return -1
        val off = p.currentLiveOffset
        if (off == C.TIME_UNSET) return -1
        return if (trick != 0) maxOf(0L, off + (p.currentPosition - trickPos)) else off   // follow the rewind as it moves
    }

    /* ---------------- pause / rewind / fast-forward ---------------- */

    private val SPEEDS = intArrayOf(2, 6, 12, 30)

    private val trickTick = object : Runnable {
        override fun run() {
            val p = player ?: return
            if (trick == 0) return
            val dur = p.duration
            trickPos += trick * 500L                 // ×6 = 3 s of programme per half-second
            if (trickPos <= 0L) { trickPos = 0; p.seekTo(0); trickStop(resume = true); return }
            if (trick > 0 && dur != C.TIME_UNSET && trickPos >= dur - maxOf(delayMs, 3000L)) {
                trickStop(resume = false); p.seekToDefaultPosition(); p.playWhenReady = true; sendState(); return
            }
            if (dur != C.TIME_UNSET && trickPos > dur) trickPos = dur
            p.seekTo(trickPos)
            sendState()
            main.postDelayed(this, 500)
        }
    }

    private fun trickPress(forward: Boolean) {
        val p = player ?: return
        if (!usingTimeshift && isLive) return
        val dir = if (forward) 1 else -1
        val cur = if (trick != 0 && Integer.signum(trick) == dir) SPEEDS.indexOf(Math.abs(trick)) else -1
        val next = SPEEDS[minOf(cur + 1, SPEEDS.size - 1)]
        if (forward && behindMs() in 0..(maxOf(delayMs, 3000L) + 1500L) && trick == 0) return   // already at live
        if (trick == 0) trickPos = p.currentPosition
        userSeek(); log("${if (forward) "fast-forward" else "rewind"}")
        trick = dir * next
        p.setSeekParameters(if (forward) SeekParameters.NEXT_SYNC else SeekParameters.PREVIOUS_SYNC)
        p.playWhenReady = false
        main.removeCallbacks(trickTick)
        main.post(trickTick)
        sendState()
    }

    private fun trickStop(resume: Boolean) {
        if (trick == 0) return
        trick = 0
        main.removeCallbacks(trickTick)
        player?.let { it.setSeekParameters(SeekParameters.DEFAULT); if (resume) it.playWhenReady = true }
        sendState()
    }

    private fun jump(ms: Long) {
        val p = player ?: return
        userSeek(); log("jump ${ms / 1000}s")
        trickStop(resume = false)
        val dur = p.duration
        var t = p.currentPosition + ms
        if (t < 0) t = 0
        if (dur != C.TIME_UNSET && t > dur - 1500) { p.seekToDefaultPosition(); return }
        p.seekTo(t)
        sendState()
    }

    private fun goLive() {
        userSeek(); log("back to live")
        trickStop(resume = false)
        player?.let { it.seekToDefaultPosition(); it.playWhenReady = true }
        sendState()
    }

    private fun togglePause() {
        if (trick != 0) { trickStop(resume = true); return }
        player?.let { it.playWhenReady = !it.playWhenReady }
        sendState()
    }

    private fun reconnect(why: String) {
        val url = currentUrl ?: return
        retries++
        log("reconnecting ($retries): $why")
        sendState("buffering")
        main.postDelayed({ if (currentUrl == url) startUrl(url) }, 1500L * retries)
    }

    private fun friendlyCode(code: Int): String = when (code) {
        469 -> "Your provider refused the stream (469 – all connections on your account are in use). Stop it on other devices, or wait a minute."
        401, 403 -> "Your provider refused the stream ($code). Check your subscription."
        404 -> "This channel isn't available right now (404)."
        else -> "Your provider replied $code."
    }

    private fun friendly(e: PlaybackException, code: Int): String = when {
        code == 469 -> "Your provider refused the stream (469 – all connections on your account are in use). Stop it on other devices, or wait a minute."
        code == 401 || code == 403 -> "Your provider refused the stream ($code). Check your subscription."
        code == 404 -> "This channel isn't available right now (404)."
        code > 0 -> "Your provider replied $code."
        e.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> "Can't reach your provider – check the internet connection."
        e.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "This channel uses a format the TV can't play."
        else -> "Can't play this channel (${e.errorCodeName})."
    }

    private fun stopPlayback() {
        stopRecorder()
        trickStop(resume = false)
        currentUrl = null
        wantVisible = false
        player?.stop()
        player?.clearMediaItems()
        playerView.visibility = View.GONE
        setFull(false)
        sendState("idle")
    }

    private fun layoutPlayer() {
        val lp = playerView.layoutParams as FrameLayout.LayoutParams
        if (fullscreen) {
            lp.width = MATCH; lp.height = MATCH; lp.leftMargin = 0; lp.topMargin = 0
        } else {
            val b = bounds ?: return
            val vw = b.optDouble("vw", 0.0)
            val scale = if (vw > 0 && web.width > 0) web.width / vw else resources.displayMetrics.density.toDouble()
            lp.leftMargin = (b.optDouble("x") * scale).toInt()
            lp.topMargin = (b.optDouble("y") * scale).toInt()
            lp.width = maxOf(1, (b.optDouble("w") * scale).toInt())
            lp.height = maxOf(1, (b.optDouble("h") * scale).toInt())
        }
        playerView.layoutParams = lp
    }

    private var phoneOrient = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR

    private fun detectTv(): Boolean {
        val ui = (getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).currentModeType
        val pm = packageManager
        if (ui == Configuration.UI_MODE_TYPE_TELEVISION || pm.hasSystemFeature("amazon.hardware.fire_tv")) return true
        // some phones claim "leanback" – only trust it when there is no touchscreen
        return pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) && !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)
    }

    /** Phone full screen: hide Android's status bar and Back / Home / Recents buttons (swipe in from the edge to
        get them back for a moment). TVs don't have them. */
    @Suppress("DEPRECATION")
    private fun systemBars(hide: Boolean) {
        if (tvDevice) return
        if (Build.VERSION.SDK_INT >= 28) {
            val lp = window.attributes
            lp.layoutInDisplayCutoutMode = if (hide) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
            window.attributes = lp
        }
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(!hide)
            val c = window.insetsController ?: return
            if (hide) {
                c.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                c.hide(android.view.WindowInsets.Type.systemBars())
            } else c.show(android.view.WindowInsets.Type.systemBars())
        } else {
            window.decorView.systemUiVisibility = if (hide)
                (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN or
                 View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
            else View.SYSTEM_UI_FLAG_VISIBLE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && fullscreen) systemBars(true)       // keep them hidden after the keyboard, a dialog, a notification…
    }

    private fun setFull(on: Boolean) {
        val wasFull = fullscreen
        fullscreen = on
        systemBars(on)
        // phones: full-screen video turns sideways; back to however you hold the phone afterwards
        if (!tvDevice) requestedOrientation = if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else phoneOrient
        layoutPlayer()
        // live, and everything on phones: the page draws the controls (touch) over the video underneath
        val liveFull = on && currentUrl != null && (isLive || !tvDevice)
        playerView.useController = on && currentUrl != null && !isLive && tvDevice     // TV films/series: play, pause, seek with the remote
        if (liveFull) {
            // live: just stretch the video (already underneath the page) and let the page hide everything but the banner
            playerView.isFocusable = false
            web.requestFocus()
            js("window.__tvFullMode && window.__tvFullMode(true)")
        } else if (on) {
            // films / series: the player's own controls need to be on top
            playerView.bringToFront()
            playerView.isFocusable = true; playerView.requestFocus()
        } else {
            if (wasFull) js("window.__tvFullMode && window.__tvFullMode(false)")
            playerView.hideController(); playerView.isFocusable = false
            if (root.getChildAt(root.childCount - 1) !== web) web.bringToFront()
            web.requestFocus()
        }
        if (!on) trickStop(resume = true)
        sendState()
    }

    private fun sendState(force: String? = null, msg: String? = null) {
        val p = player
        val st = force ?: when {
            p == null || currentUrl == null -> "idle"
            p.playbackState == Player.STATE_BUFFERING -> "buffering"
            p.playbackState == Player.STATE_READY && p.playWhenReady -> "playing"
            p.playbackState == Player.STATE_READY -> "paused"
            p.playbackState == Player.STATE_ENDED -> "ended"
            else -> "buffering"
        }
        val o = JSONObject().put("state", st).put("full", fullscreen).put("live", isLive).put("volume", 256)
            .put("trick", trick).put("paused", p != null && !p.playWhenReady).put("behind", behindMs())
            .put("delay", delayMs).put("timeshift", usingTimeshift)
        if (p != null && usingTimeshift && p.duration != C.TIME_UNSET) o.put("window", p.duration).put("pos", p.currentPosition)
        if (msg != null) o.put("msg", msg)
        if (p != null && currentUrl != null) o.put("net", netJson(p))
        p?.let { if (!isLive && it.duration > 0) { o.put("time", it.currentPosition / 1000); o.put("length", it.duration / 1000) } }
        lastStatus = o.toString()
        if (pipOk) main.post { updatePip() }
        js("window.__nativeState && window.__nativeState($lastStatus)")
    }

    /** Connection health for the page: speed in, speed needed, how well it keeps up, recent stalls. */
    private fun netJson(p: ExoPlayer): JSONObject {
        val now = System.currentTimeMillis()
        val o = JSONObject()
            .put("stalls1", stalls.count { now - it < 60_000 })
            .put("stalls10", stalls.count { now - it < 600_000 })
            .put("ahead", p.totalBufferedDuration)
        val ns = if (usingTimeshift) recorder?.netStats() else null
        if (ns != null) o.put("down", ns[0]).put("need", ns[1]).put("factor", ns[2] / 1000.0)
        else {
            val est = try { androidx.media3.exoplayer.upstream.DefaultBandwidthMeter.getSingletonInstance(this).bitrateEstimate } catch (e: Exception) { 0L }
            if (est > 0) o.put("down", est / 1000)
            val br = p.videoFormat?.bitrate ?: -1
            if (br > 0) o.put("need", (br + (p.audioFormat?.bitrate?.coerceAtLeast(0) ?: 0)) / 1000)
        }
        return o
    }

    private fun js(code: String) = main.post { web.evaluateJavascript(code, null) }

    // recent events, shown in Settings → Playback log (so problems can be seen without a computer)
    private val recentLog = ArrayDeque<String>()
    private val logTime = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.UK)
    private fun log(line: String) {
        Log.i("StarkTV", line)
        synchronized(recentLog) { recentLog.addLast(logTime.format(java.util.Date()) + "  " + line); while (recentLog.size > 300) recentLog.removeFirst() }
        try {
            val f = File(filesDir, "starktv-log.txt")
            if (f.length() > 2_000_000) f.delete()
            f.appendText("${System.currentTimeMillis()} $line\n")
        } catch (_: Exception) {}
    }

    /* ---------------- remote control ---------------- */

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        val code = e.keyCode
        val down = e.action == KeyEvent.ACTION_DOWN
        val liveFull = fullscreen && isLive && currentUrl != null

        // watching live full screen: the remote drives the info banner and the timeshift
        if (liveFull) {
            when (code) {
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                    if (down && e.repeatCount == 0) {
                        val up = code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_CHANNEL_UP
                        js("window.__tvZap && window.__tvZap(${if (up) -1 else 1})")
                    }
                    return true
                }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                    if (down && e.repeatCount == 0) js("window.__osdKey && window.__osdKey('ok')")
                    return true
                }
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> {
                    // banner showing: move between its buttons; banner hidden: jump 10 s (the page decides)
                    if (down) js("window.__osdKey && window.__osdKey('${if (code == KeyEvent.KEYCODE_DPAD_LEFT) "left" else "right"}')")
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                    if (down && e.repeatCount == 0) { trickPress(code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD); js("window.__osdShow && window.__osdShow()") }
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                    // tap = play/pause, hold = back to live
                    if (down && e.repeatCount == 0) { playHeldDown = System.currentTimeMillis(); playLongDone = false }
                    else if (down && !playLongDone && System.currentTimeMillis() - playHeldDown > 600) {
                        playLongDone = true; goLive(); js("window.__osdShow && window.__osdShow()")
                    } else if (!down && !playLongDone) { togglePause(); js("window.__osdShow && window.__osdShow()") }
                    return true
                }
                KeyEvent.KEYCODE_BACK -> {
                    if (!down) return true
                    if (trick != 0) { trickStop(resume = true); js("window.__osdShow && window.__osdShow()"); return true }
                    web.evaluateJavascript("(window.__osdBack && window.__osdBack()) ? 1 : 0") { r ->
                        if (r == null || !r.contains("1")) { setFull(false); js("window.__tvAfterFull && window.__tvAfterFull()") }
                    }
                    return true
                }
                KeyEvent.KEYCODE_MENU -> {
                    if (down) js("window.__tvFavCurrent && window.__tvFavCurrent()")
                    return true
                }
            }
            return super.dispatchKeyEvent(e)
        }

        // a search / voice key that reaches the app (most Fire TV remotes send the mic to Alexa instead)
        if (code == KeyEvent.KEYCODE_SEARCH || code == KeyEvent.KEYCODE_VOICE_ASSIST) {
            if (down && e.repeatCount == 0) js("window.__voiceKey && window.__voiceKey()")
            return true
        }
        val handled = code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
        if (!handled) return super.dispatchKeyEvent(e)
        if (!down) return true
        when (code) {
            KeyEvent.KEYCODE_BACK -> {
                if (fullscreen) { setFull(false); js("window.__tvAfterFull && window.__tvAfterFull()") }
                else web.evaluateJavascript("(window.__tvBack && window.__tvBack()) ? 1 : 0") { r ->
                    if (r == null || !r.contains("1")) {
                        val now = System.currentTimeMillis()
                        if (now - lastBack < 2500) finish()
                        else { lastBack = now; Toast.makeText(this, "Press Back again to exit StarkTV", Toast.LENGTH_SHORT).show() }
                    }
                }
            }
            KeyEvent.KEYCODE_MENU ->
                if (fullscreen) js("window.__tvFavCurrent && window.__tvFavCurrent()")   // watching: star this channel
                else js("window.__tvMenu && window.__tvMenu()")                            // browsing: menu for the highlighted channel
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> togglePause()
        }
        return true
    }

    /* ---------------- voice search ---------------- */

    private val voiceReq = 4711

    fun startVoice() {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Say e.g. \u201cLiverpool live TV\u201d or \u201cBad Boys film\u201d")
        }
        try { startActivityForResult(i, voiceReq) }
        catch (e: Exception) { js("window.__voiceUnavailable && window.__voiceUnavailable()") }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != voiceReq || resultCode != RESULT_OK) return
        val said = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: return
        js("window.__voiceResult && window.__voiceResult(${JSONObject.quote(said)})")
    }

    /* ---------------- lifecycle ---------------- */

    private var stoppedLive = false

    /* ---------------- picture in picture (phones / tablets, Android 8+) ---------------- */

    private var inPip = false
    private val pipOk get() = !tvDevice && Build.VERSION.SDK_INT >= 26 && packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    private val pipAction = "tv.stark.app.PIP_PLAYPAUSE"
    private val pipReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) { if (i?.action == pipAction) { togglePause(); updatePip() } }
    }
    private var pipRegistered = false

    private fun pipParams(): PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < 26) return null
        val p = player
        val vs = p?.videoSize
        val ratio = if (vs != null && vs.width > 0 && vs.height > 0) {
            val r = vs.width.toDouble() * vs.pixelWidthHeightRatio / vs.height
            if (r in 0.42..2.38) Rational((r * 1000).toInt(), 1000) else Rational(16, 9)
        } else Rational(16, 9)
        val playing = p?.playWhenReady == true
        val pi = PendingIntent.getBroadcast(this, 1, Intent(pipAction).setPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0))
        val act = RemoteAction(Icon.createWithResource(this, if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
            if (playing) "Pause" else "Play", if (playing) "Pause" else "Play", pi)
        val b = PictureInPictureParams.Builder().setAspectRatio(ratio).setActions(listOf(act))
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(currentUrl != null && wantVisible).setSeamlessResizeEnabled(true)
        return b.build()
    }

    /** keep the system's PiP settings current (aspect ratio, play/pause button, auto-enter on Home) */
    private fun updatePip() {
        if (!pipOk || Build.VERSION.SDK_INT < 26) return
        try { pipParams()?.let { setPictureInPictureParams(it) } } catch (_: Exception) {}
    }

    fun enterPip(): Boolean {
        if (!pipOk || currentUrl == null || Build.VERSION.SDK_INT < 26) return false
        return try { pipParams()?.let { enterPictureInPictureMode(it) } ?: false } catch (e: Exception) { log("pip: ${e.message}"); false }
    }

    // Home / switching apps while something plays → it carries on in a small window (Android 8–11; 12+ does it itself)
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (pipOk && Build.VERSION.SDK_INT < 31 && currentUrl != null && wantVisible && player?.playWhenReady == true) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
        if (inPip) {
            if (!pipRegistered) {
                if (Build.VERSION.SDK_INT >= 33) registerReceiver(pipReceiver, IntentFilter(pipAction), Context.RECEIVER_NOT_EXPORTED)
                else registerReceiver(pipReceiver, IntentFilter(pipAction))
                pipRegistered = true
            }
            // the small window shows just the picture
            val lp = playerView.layoutParams as FrameLayout.LayoutParams
            lp.width = MATCH; lp.height = MATCH; lp.leftMargin = 0; lp.topMargin = 0
            playerView.layoutParams = lp
            playerView.hideController(); playerView.useController = false
            playerView.bringToFront()
            web.visibility = View.INVISIBLE
        } else {
            if (pipRegistered) { try { unregisterReceiver(pipReceiver) } catch (_: Exception) {}; pipRegistered = false }
            web.visibility = View.VISIBLE
            playerView.useController = fullscreen && !isLive
            web.bringToFront()
            if (fullscreen) playerView.bringToFront()
            layoutPlayer()
            js("window.__pipEnded && window.__pipEnded()")
        }
    }

    /* Live TV must never go backwards on its own. Every second: which moment of the programme is on screen
       (wall clock minus how far behind live). If that moment goes back by more than 3 s and you didn't rewind,
       jump forward again to where you were – and note it in the playback log. */
    private var lastContentT = 0L
    private var userSeekAt = 0L
    private fun userSeek() { userSeekAt = System.currentTimeMillis(); lastContentT = 0L }
    private fun replayGuard() {
        val p = player ?: return
        if (!isLive || !usingTimeshift || trick != 0 || !p.isPlaying) { if (trick != 0 || !isLive) lastContentT = 0L; return }
        val off = p.currentLiveOffset; if (off == C.TIME_UNSET) return
        val now = System.currentTimeMillis()
        val t = now - off
        if (lastContentT > 0 && now - userSeekAt > 4000) {
            val back = lastContentT - t
            if (back > 3000) {
                log("live went back ${back / 1000}s by itself (behind live ${off / 1000}s) – jumping forward again")
                p.seekTo(p.currentPosition + back)
                lastContentT = t + back
                return
            }
        }
        lastContentT = maxOf(lastContentT, t)
    }

    /* Picture frozen but the sound carries on: if no new video frame has been shown for 3 seconds while playing,
       restart the picture at the same spot (clears the video decoder). If it keeps happening on a live channel,
       reconnect the channel. */
    private var lastRendered = -1
    private var frozenSecs = 0
    private val freezeFixes = ArrayDeque<Long>()
    private fun videoWatch() {
        val p = player ?: return
        if (!p.isPlaying || trick != 0 || p.playbackState != Player.STATE_READY || p.videoFormat == null) { frozenSecs = 0; lastRendered = -1; return }
        val c = p.videoDecoderCounters ?: return
        c.ensureUpdated()
        val r = c.renderedOutputBufferCount
        frozenSecs = if (r == lastRendered) frozenSecs + 1 else 0
        lastRendered = r
        if (frozenSecs < 3) return
        frozenSecs = 0; lastRendered = -1
        val now = System.currentTimeMillis()
        freezeFixes.addLast(now); while (freezeFixes.isNotEmpty() && now - freezeFixes.first() > 90_000) freezeFixes.removeFirst()
        if (freezeFixes.size >= 3 && isLive && currentUrl != null) {
            log("picture keeps freezing – reconnecting the channel")
            freezeFixes.clear(); retries = 0; reconnect("picture frozen")
        } else {
            log("picture froze (sound still playing) – restarting the picture")
            userSeek(); p.seekTo(p.currentPosition)
        }
    }

    /* Builds the live delay (Settings → Live delay, or 45 s on slow internet) by playing at 97 % until the picture is
       that far behind live, then normal speed. Done here rather than left to the player's own live-speed logic,
       which on these home-made streams often never slowed down – the delay sat at about 1 second. */
    private var curSpeed = 1f
    private fun setSpeed(v: Float) {
        val p = player ?: return
        if (curSpeed == v) return
        curSpeed = v
        p.setPlaybackSpeed(v)
    }
    private fun delayBuilder() {
        val p = player ?: return
        if (!isLive || !usingTimeshift || trick != 0) { if (curSpeed != 1f) setSpeed(1f); return }
        if (!p.isPlaying) return
        val off = p.currentLiveOffset; if (off == C.TIME_UNSET) return
        val target = delayMs
        when {
            off < target - 700 -> setSpeed(0.97f)                    // still building: 97 % (sound pitch is kept)
            target <= 3000 && off > target + 3000 -> setSpeed(1.03f) // "as close to live as possible": catch up a little
            else -> setSpeed(1f)
        }
    }

    // films / episodes: keep the position fresh for the page, which remembers where you got to
    private val progressTick = object : Runnable {
        override fun run() {
            if (currentUrl != null && !isLive && player?.isPlaying == true) sendState()
            replayGuard()
            delayBuilder()
            videoWatch()
            main.postDelayed(this, 1000)
        }
    }

    override fun onPause() {
        super.onPause()
        if (currentUrl != null && !isLive) { sendState(); js("window.__saveProgress && window.__saveProgress()") }   // remember the spot before leaving
        if (inPip || (Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode)) return     // keep playing in the small window
        player?.playWhenReady = false
    }

    override fun onStop() {
        super.onStop()
        // PiP window closed (or app left without PiP): stop, and don't hold a connection in the background
        if (currentUrl != null && isLive) { stopRecorder(); player?.stop(); stoppedLive = true }
        else player?.playWhenReady = false
    }

    /* ---------------- updates (from the GitHub release) ---------------- */

    private val updAction = "tv.stark.app.UPDATE_STATUS"
    private var pendingUpdateUrl: String? = null
    private val updReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            if (i?.action != updAction) return
            when (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION")
                    val confirm = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                    if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(confirm) }
                }
                PackageInstaller.STATUS_SUCCESS -> log("update installed")
                else -> {
                    val m = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "install cancelled"
                    log("update: $m"); js("window.__updError && window.__updError(${JSONObject.quote(m)})")
                }
            }
        }
    }
    private var updRegistered = false

    /** the Fire Stick build can install its own updates; the phone build (no install permission) uses the browser */
    private val canSelfInstall: Boolean by lazy {
        try {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(packageName, PackageManager.GET_PERMISSIONS).requestedPermissions?.contains("android.permission.REQUEST_INSTALL_PACKAGES") == true
        } catch (_: Exception) { false }
    }

    private fun installUpdate(url: String) {
        if (!canSelfInstall) {
            try { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); js("window.__updBrowser && window.__updBrowser()") }
            catch (e: Exception) { js("window.__updError && window.__updError('No web browser to download it with')") }
            return
        }
        // Android 8+: StarkTV needs "Install unknown apps" once – send them to that switch, carry on when they're back
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            pendingUpdateUrl = url
            js("window.__updNeedPermission && window.__updNeedPermission()")
            try {
                startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:$packageName")))
            } catch (e: Exception) { js("window.__updError && window.__updError('Allow StarkTV to install apps in Settings → Apps → StarkTV')") }
            return
        }
        if (!updRegistered) {
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(updReceiver, IntentFilter(updAction), Context.RECEIVER_NOT_EXPORTED)
            else registerReceiver(updReceiver, IntentFilter(updAction))
            updRegistered = true
        }
        kotlin.concurrent.thread(name = "starktv-update") {
            try {
                val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                c.instanceFollowRedirects = true; c.connectTimeout = 20000; c.readTimeout = 30000
                c.setRequestProperty("User-Agent", "StarkTV-updater")
                if (c.responseCode != 200) throw java.io.IOException("download failed (${c.responseCode})")
                val total = c.contentLength.toLong()
                val pi = packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                if (total > 0) params.setSize(total)
                val id = pi.createSession(params)
                pi.openSession(id).use { session ->
                    session.openWrite("StarkTV.apk", 0, if (total > 0) total else -1).use { out ->
                        c.inputStream.use { inp ->
                            val buf = ByteArray(64 * 1024); var done = 0L; var last = -1
                            while (true) {
                                val n = inp.read(buf); if (n < 0) break
                                out.write(buf, 0, n); done += n
                                if (total > 0) { val pct = (done * 100 / total).toInt(); if (pct != last) { last = pct; js("window.__updProgress && window.__updProgress($pct)") } }
                            }
                        }
                        session.fsync(out)
                    }
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                    val pending = PendingIntent.getBroadcast(this, 7, Intent(updAction).setPackage(packageName), flags)
                    session.commit(pending.intentSender)
                }
                js("window.__updProgress && window.__updProgress(100)")
            } catch (e: Exception) {
                log("update: ${e.message}")
                js("window.__updError && window.__updError(${JSONObject.quote(e.message ?: "download failed")})")
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // back from the "Install unknown apps" switch: carry on with the update
        pendingUpdateUrl?.let { u ->
            if (Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls()) { pendingUpdateUrl = null; installUpdate(u) }
            else { pendingUpdateUrl = null; js("window.__updError && window.__updError('StarkTV wasn’t allowed to install updates')") }
        }
        val url = currentUrl ?: return
        if (isLive) { if (stoppedLive) { stoppedLive = false; startUrl(url) } else player?.playWhenReady = true }
        else player?.playWhenReady = true
    }

    override fun onDestroy() {
        stopRecorder()
        player?.release(); player = null
        web.destroy()
        super.onDestroy()
    }

    /* ---------------- bridge for the page (window.AndroidBridge) ---------------- */

    inner class Bridge {
        @JavascriptInterface fun loadProfiles(): String = prefs.getString("profiles", "") ?: ""
        @JavascriptInterface fun saveProfiles(json: String): Boolean { prefs.edit().putString("profiles", json).apply(); return true }
        @JavascriptInterface fun log(line: String) = this@MainActivity.log(line)
        @JavascriptInterface fun status(): String = lastStatus
        /** true on a TV / Fire TV, false on a phone or tablet */
        @JavascriptInterface fun isTv(): Boolean = tvDevice
        @JavascriptInterface fun voiceSearch() = main.post { this@MainActivity.startVoice() }
        // Fire TV has no speech service for apps (its mic button always goes to Alexa); phones do
        @JavascriptInterface fun hasVoice(): Boolean = try {
            packageManager.queryIntentActivities(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0).isNotEmpty()
        } catch (e: Exception) { false }
        // phones: 'landscape' once signed in, 'any' on the sign-in page (so typing is easy upright)
        @JavascriptInterface fun setOrientation(mode: String) = main.post {
            if (tvDevice) return@post
            phoneOrient = when (mode) {
                "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                "auto" -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER          // follows the phone (and its rotation lock)
                else -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
            }
            if (!fullscreen) requestedOrientation = phoneOrient
        }
        // phone sliders: screen brightness for this app (0–1) and media volume (0–1)
        @JavascriptInterface fun getBrightness(): Float {
            val w = window.attributes.screenBrightness
            if (w >= 0f) return w
            return try { android.provider.Settings.System.getInt(contentResolver, android.provider.Settings.System.SCREEN_BRIGHTNESS) / 255f } catch (_: Exception) { 0.5f }
        }
        @JavascriptInterface fun setBrightness(v: Float) = main.post {
            val lp = window.attributes; lp.screenBrightness = v.coerceIn(0.01f, 1f); window.attributes = lp
        }
        @JavascriptInterface fun getVolume(): Float {
            val am = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
            val max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC).coerceAtLeast(1)
            return am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC).toFloat() / max
        }
        @JavascriptInterface fun setVolume(v: Float) = main.post {
            val am = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
            val max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
            try { am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, Math.round(v.coerceIn(0f, 1f) * max), 0) } catch (_: Exception) {}
        }
        @JavascriptInterface fun pip(): Boolean = this@MainActivity.pipOk
        @JavascriptInterface fun enterPip() = main.post { this@MainActivity.enterPip() }
        @JavascriptInterface fun exitFull() = main.post { if (fullscreen) { setFull(false); js("window.__tvAfterFull && window.__tvAfterFull()") } }
        @JavascriptInterface fun tracks(): String = tracksJson
        @JavascriptInterface fun chooseTrack(kind: String, g: Int, t: Int) = main.post { this@MainActivity.chooseTrack(kind, g, t) }
        @JavascriptInterface fun versionCode(): Long =
            try { val pi = packageManager.getPackageInfo(packageName, 0); if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong() } catch (_: Exception) { 0L }
        @JavascriptInterface fun selfInstall(): Boolean = this@MainActivity.canSelfInstall
        @JavascriptInterface fun installUpdate(url: String) = main.post { this@MainActivity.installUpdate(url) }
        @JavascriptInterface fun version(): String =
            try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (_: Exception) { "" }

        @JavascriptInterface fun play(url: String) = main.post {
            if (url == currentUrl && player != null && (recorder != null || !isLive)) { sendState(); return@post }   // already on it
            currentUrl = url; retries = 0; wantVisible = true
            playerView.visibility = View.VISIBLE
            layoutPlayer()
            startUrl(url)
            if (fullscreen) setFull(true)    // refresh controller for live vs film
        }

        @JavascriptInterface fun stop() = main.post { stopPlayback() }
        @JavascriptInterface fun togglePause() = main.post { this@MainActivity.togglePause() }
        @JavascriptInterface fun goLive() = main.post { this@MainActivity.goLive() }
        @JavascriptInterface fun seekTo(ms: Long) = main.post { userSeek(); player?.seekTo(ms) }
        @JavascriptInterface fun getLog(): String = synchronized(recentLog) { recentLog.joinToString("\n") }
        /** where the next film / episode should start (resume) – sent before play() */
        @JavascriptInterface fun setStart(ms: Long) = main.post { startAtMs = maxOf(0L, ms) }
        @JavascriptInterface fun jumpBy(ms: Int) = main.post { this@MainActivity.jump(ms.toLong()) }
        @JavascriptInterface fun trick(forward: Boolean) = main.post { this@MainActivity.trickPress(forward) }
        @JavascriptInterface fun refreshStatus(): String { main.post { sendState() }; return lastStatus }
        @JavascriptInterface fun setOptions(json: String) = main.post {
            try {
                val o = JSONObject(json)
                val old = delayMs
                delayMs = o.optLong("delay", 15L) * 1000L
                if (delayMs != old && usingTimeshift) liveSpeed.setTargetLiveOffsetOverrideUs(maxOf(delayMs, 3000L) * 1000L)
                keepMs = maxOf(1L, o.optLong("keepMin", 30L)) * 60_000L
                if (o.has("subs")) { val on = o.optString("subs") == "on"; if (on != subsOn) { subsOn = on; player?.let { applySubsDefault(it) } } }
            } catch (_: Exception) {}
        }
        @JavascriptInterface fun setFullscreen(on: Boolean) = main.post {
            if (currentUrl != null || !on) setFull(on)
            else js("window.__tvFullMode && window.__tvFullMode(false)")   // nothing playing: bring the page back
        }
        @JavascriptInterface fun setBounds(json: String) = main.post {
            try { bounds = JSONObject(json); layoutPlayer() } catch (_: Exception) {}
        }
        @JavascriptInterface fun setVisible(v: Boolean) = main.post {
            playerView.visibility = if (v && wantVisible) View.VISIBLE else View.GONE
        }
        @JavascriptInterface fun exitApp() = main.post { finish() }
        @JavascriptInterface fun toast(text: String) = main.post { Toast.makeText(this@MainActivity, text, Toast.LENGTH_SHORT).show() }
    }
}
