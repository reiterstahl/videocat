package app.videocat.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLockTest {
    @Test
    fun aStayInTheBackgroundExpiresAfterTheChosenDelay() {
        // Not in the background since the last unlock: nothing to expire.
        assertFalse(AppLock.expired(backgroundSinceMs = null, nowMs = 10_000, delaySeconds = 0))
        // One minute grace.
        assertFalse(AppLock.expired(backgroundSinceMs = 100_000, nowMs = 159_999, delaySeconds = 60))
        assertTrue(AppLock.expired(backgroundSinceMs = 100_000, nowMs = 160_000, delaySeconds = 60))
        // Right away.
        assertTrue(AppLock.expired(backgroundSinceMs = 100_000, nowMs = 100_000, delaySeconds = 0))
        // Up to 15 minutes.
        assertFalse(AppLock.expired(backgroundSinceMs = 0, nowMs = 899_999, delaySeconds = 900))
        assertTrue(AppLock.expired(backgroundSinceMs = 0, nowMs = 900_000, delaySeconds = 900))
    }

    @Test
    fun offersRightAwayAndOneFiveAndFifteenMinutes() {
        assertEquals(listOf(0, 60, 300, 900), AppLock.delays)
    }
}
