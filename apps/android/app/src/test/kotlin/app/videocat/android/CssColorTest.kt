package app.videocat.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CssColorTest {
    @Test
    fun readsComputedColors() {
        assertEquals(0xFF15181C.toInt(), CssColor.parse("rgb(21, 24, 28)"))
        assertEquals(0xFFFFFFFF.toInt(), CssColor.parse("rgba(255, 255, 255, 1)"))
        assertEquals(0xFF000000.toInt(), CssColor.parse("rgb(0 0 0 / 100%)"))
    }

    @Test
    fun ignoresTransparentAndUnknownColors() {
        assertNull(CssColor.parse("rgba(0, 0, 0, 0)"))
        assertNull(CssColor.parse("rgba(21, 24, 28, 0.5)"))
        assertNull(CssColor.parse("oklch(0.2 0.01 250)"))
        assertNull(CssColor.parse("rgb(300, 0, 0)"))
        assertNull(CssColor.parse(""))
    }

    @Test
    fun picksIconsThatRead() {
        assertTrue(CssColor.isLight(0xFFFFFFFF.toInt()))
        assertFalse(CssColor.isLight(0xFF15181C.toInt()))
    }
}
