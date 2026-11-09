package tv.stark.app

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.ByteArrayInputStream
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream

/** Serves the timeshift playlist and its segments to ExoPlayer straight from the recorder (no web server needed). */
@OptIn(UnstableApi::class)
class TimeshiftDataSource(private val recorder: () -> TimeshiftRecorder?) : DataSource {
    private var uri: Uri? = null
    private var stream: InputStream? = null
    private var remaining = 0L

    override fun addTransferListener(transferListener: TransferListener) {}

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        val rec = recorder() ?: throw IOException("no recording")
        val name = dataSpec.uri.lastPathSegment ?: ""
        val total: Long
        if (name.endsWith(".m3u8")) {
            val b = rec.playlist().toByteArray()
            stream = ByteArrayInputStream(b); total = b.size.toLong()
        } else {
            val f = rec.segmentFile(name) ?: throw FileNotFoundException(name)
            stream = FileInputStream(f); total = f.length()
        }
        if (dataSpec.position > 0) stream!!.skip(dataSpec.position)
        remaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else total - dataSpec.position
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining <= 0L) return C.RESULT_END_OF_INPUT
        val n = stream?.read(buffer, offset, minOf(length.toLong(), remaining).toInt()) ?: -1
        if (n < 0) return C.RESULT_END_OF_INPUT
        remaining -= n
        return n
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        try { stream?.close() } catch (_: Exception) {}
        stream = null; uri = null
    }
}
