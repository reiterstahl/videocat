package app.videocat.android

import kotlin.math.abs

/** Going through the video with a horizontal swipe, as in MX Player. */
object SwipeSeek {
    /** A swipe across the whole width of the screen moves this much. */
    const val FULL_WIDTH_MS = 120_000L

    /** Where a swipe of [dxPx] (right is forward) over a view [widthPx] wide lands, within the video. */
    fun target(startMs: Long, dxPx: Float, widthPx: Int, durationMs: Long): Long {
        if (widthPx <= 0) return startMs
        val offset = (dxPx / widthPx * FULL_WIDTH_MS).toLong()
        return (startMs + offset).coerceIn(0L, maxOf(0L, durationMs))
    }

    /** "+0:15" and, below, "12:34 / 45:00". */
    fun label(offsetMs: Long, targetMs: Long, durationMs: Long): String {
        val sign = if (offsetMs < 0) "−" else "+"
        return "$sign${time(abs(offsetMs))}\n${time(targetMs)} / ${time(durationMs)}"
    }

    fun time(ms: Long): String {
        val total = ms / 1000
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
    }
}
