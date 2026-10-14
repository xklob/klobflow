package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

/** A committed native oracle guards the browser port against geometry/tracking drift. */
class BrowserParityTest {
    fun canonical(value:Any?):String=when(value){
        is JSONObject->value.keys().asSequence().toList().sorted().joinToString(prefix="{",postfix="}"){it+":"+canonical(value.get(it))}
        is JSONArray->(0 until value.length()).joinToString(prefix="[",postfix="]"){canonical(value.get(it))}
        is Number->value.toDouble().toString()
        else->value.toString()
    }

    @Test fun nativeOracleMatchesCommittedBrowserFixture() {
        val a=Segment(P(.18,.25),P(.53,.76));val b=Segment(P(.80,.72),P(1.15,.20))
        val tracker=StaffTracker()
        val inputs=listOf(listOf(a,b),listOf(a,b),listOf(a,b),listOf(a,b),listOf(a.copy(b=(a.a+a.b)*.5),b),listOf(b),listOf(a,b),listOf(a,b),listOf(a,b),emptyList(),emptyList())
        val times=listOf(1000L,1033,1066,1099,1132,1165,1198,1231,1264,1300,3000)
        val steps=inputs.mapIndexed {i,s->JSONObject().put("time",times[i]).put("input",JSONArray(s.map {it.json()})).put("output",JSONArray(tracker.update(s,times[i]).map {it?.json() ?: JSONObject.NULL}))}
        val guides=listOf("grid","circles","cube","free").flatMap {mode->listOf(false,true).map {perspective->
            val c=Config(mode=mode,rotation=14.0,planeCorners=if(perspective)listOf(P(.13,.1),P(.85,.18),P(.91,.9),P(.06,.81)) else emptyList(),calibrationImageAspect=4.0/3)
            val g=Guide(c,640,480)
            JSONObject().put("config",c.json()).put("width",640).put("height",480).put("guide",g.json()).put("metrics",Scorer().score(1000,listOf(a,b),g).json()).put("feedback",JSONArray(g.cues(listOf(a,b)).map {it.json()}))
        }}
        val w=320;val h=240;val pixels=IntArray(w*h){0xff101510.toInt()}
        for((s,color) in listOf(a to 0xffb6f36b.toInt(),b to 0xffb5a3ff.toInt()))for(y in 0 until h)for(x in 0 until w)if(distanceToSegment(P(x.toDouble()/h,y.toDouble()/h),s)<.012)pixels[y*w+x]=color
        val fixture=JSONObject().put("staffs",JSONArray(listOf(a.json(),b.json()))).put("steps",JSONArray(steps)).put("guides",JSONArray(guides)).put("detected",JSONArray(StaffDetector().detect(pixels,w,h,Config()).map {it.json()}))
        val file=File("../companion/test/fixtures/native-core.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1"){file.parentFile.mkdirs();file.writeText(fixture.toString(2)+"\n")}
        assertTrue("Native outputs changed: deliberately regenerate the shared fixture, then run browser parity tests",canonical(JSONObject(file.readText()))==canonical(fixture))
    }
    @Test fun restoredCalibrationAndZoomSurviveSavedConfig() {
        val original=Config(facing="back",zoom=2.0,planeCorners=listOf(P(.1,.1),P(.9,.1),P(.9,.9),P(.1,.9)),calibrationImageAspect=4.0/3)
        assertEquals(original,Config().patch(original.json(),restore=true))
        assertTrue(original.patch(JSONObject().put("zoom",3.0)).planeCorners.isEmpty())
    }
    @Test fun hiddenTipPreservesIdentityWithoutInventingPrecision() {
        val a=Segment(P(.15,.3),P(.65,.3));val b=Segment(P(.8,.2),P(.8,.8));val t=StaffTracker()
        repeat(4){t.update(listOf(a,b),1000L+it*33)}
        val hidden=t.update(listOf(a.copy(b=P(.35,.3)),b),1132)
        assertTrue(hidden[0]!!.occluded);assertTrue(hidden[1]!!.confidence>=.55)
        assertNull(Scorer().score(1132,hidden,Guide(Config(),640,480)).deviation)
        assertTrue(t.update(listOf(b),1165)[0]!!.occluded)
        repeat(3){t.update(listOf(a,b),1198L+it*33)}
        assertTrue(t.update(listOf(a,b),1300).all {it!=null && !it.occluded && it.confidence>=.55})
        assertTrue(t.update(emptyList(),3000).all {it==null})
    }
}
