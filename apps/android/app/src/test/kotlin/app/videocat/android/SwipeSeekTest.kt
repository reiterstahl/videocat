package app.videocat.android

import org.junit.Assert.assertEquals
import org.junit.Test

class SwipeSeekTest {
    @Test
    fun aSwipeMovesInProportionToTheWidthWithinTheVideo() {
        // Half the width forward: one minute.
        assertEquals(160_000L, SwipeSeek.target(100_000, 540f, 1080, 3_600_000))
        // A quarter back.
        assertEquals(70_000L, SwipeSeek.target(100_000, -270f, 1080, 3_600_000))
        // Never before the start or past the end.
        assertEquals(0L, SwipeSeek.target(10_000, -1080f, 1080, 3_600_000))
        assertEquals(300_000L, SwipeSeek.target(250_000, 1080f, 1080, 300_000))
    }

    @Test
    fun labelsTheJumpAndWhereItLands() {
        assertEquals("1:55 / 45:00 · +0:15", SwipeSeek.label(15_000, 115_000, 2_700_000))
        assertEquals("1:02:03 / 2:00:00 · −1:05", SwipeSeek.label(-65_000, 3_723_000, 7_200_000))
    }

    @Test
    fun placesAPositionOnTheBar() {
        assertEquals(500, SwipeSeek.permille(30_000, 60_000))
        assertEquals(0, SwipeSeek.permille(5_000, 0))
        assertEquals(1000, SwipeSeek.permille(90_000, 60_000))
    }
}
