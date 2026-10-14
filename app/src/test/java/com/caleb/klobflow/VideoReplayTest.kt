package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.json.JSONObject
import java.io.DataInputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToLong

/** Opt-in local comparison using evaluate-video.mjs output and matching BGRA frames.
 * Private recordings/decoded pixels are never fixtures or publication artifacts. */
class VideoReplayTest {
    @Test fun nativeAndBrowserAgreeOnLocalVideo() {
        val json=System.getenv("KLOBFLOW_REPLAY_JSON");val raw=System.getenv("KLOBFLOW_REPLAY_BGRA")
        assumeTrue("Set both local replay paths to run this diagnostic",json!=null&&raw!=null)
        val report=JSONObject(File(json!!).readText());val summary=report.getJSONObject("summary")
        val w=summary.getInt("width");val h=summary.getInt("height");val c=Config().patch(report.getJSONObject("config"))
        val rows=report.getJSONArray("rows");val detector=StaffDetector();val tracker=StaffTracker()
        val bytes=ByteArray(w*h*4);val view=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer();val pixels=IntArray(w*h)
        var observed=0;var precise=0
        DataInputStream(File(raw!!).inputStream().buffered()).use {input->
            repeat(rows.length()){i->
                input.readFully(bytes);view.position(0);view.get(pixels)
                val row=rows.getJSONObject(i);val time=(1000+row.getDouble("time")*1000).roundToLong()
                val actual=tracker.update(detector.detect(pixels,w,h,c,tracker.hints(time,c.staffCount)),time,c.staffCount)
                val expected=row.getJSONArray("staffs")
                actual.forEachIndexed {n,s->
                    if(expected.isNull(n))assertNull("Frame $i staff $n",s) else {
                        assertNotNull("Frame $i staff $n",s);s!!;val e=expected.getJSONObject(n)
                        for((key,p) in listOf("a" to s.a,"b" to s.b)) {
                            assertEquals("Frame $i staff $n $key.x",e.getJSONArray(key).getDouble(0),p.x,1e-7)
                            assertEquals("Frame $i staff $n $key.y",e.getJSONArray(key).getDouble(1),p.y,1e-7)
                        }
                        assertEquals(e.getDouble("confidence"),s.confidence,1e-8)
                        assertEquals(e.optBoolean("blurred"),s.blurred);assertEquals(e.optBoolean("occluded"),s.occluded)
                    }
                }
                if(actual.take(c.staffCount).all {it!=null&&!it.occluded})observed++
                if(actual.take(c.staffCount).all {it!=null&&it.confidence>=.55})precise++
            }
            assertEquals("BGRA cache and report must contain the same frames",-1,input.read())
        }
        println("Native/browser replay parity: ${rows.length()} frames, $observed observed, $precise precise")
    }
}
