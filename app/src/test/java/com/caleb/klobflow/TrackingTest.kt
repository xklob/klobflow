package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import kotlin.math.*

class TrackingTest {
    private val w=320;private val h=240
    private fun frame(vararg lines: Pair<Segment,Int>,blob:Boolean=false):IntArray {
        val pixels=IntArray(w*h){0xff101510.toInt()}
        lines.forEach {(s,color)->for(y in 0 until h)for(x in 0 until w)if(distanceToSegment(P(x.toDouble()/h,y.toDouble()/h),s)<0.012)pixels[y*w+x]=color}
        if(blob)for(y in 15..45)for(x in 130..170)pixels[y*w+x]=0xffffffff.toInt()
        return pixels
    }
    private val a=Segment(P(.18,.25),P(.53,.76))
    private val b=Segment(P(.80,.72),P(1.15,.20))
    @Test fun detectsTwoUnmarkedGlowingStavesWithBrightDistractor(){
        val result=StaffDetector().detect(frame(a to 0xffb6f36b.toInt(),b to 0xffb5a3ff.toInt(),blob=true),w,h,Config())
        for(expected in listOf(a,b))assertTrue("Expected $expected, got $result",result.any {it.center.distance(expected.center)<.04 && angleDifference(it.angle,expected.angle)<.08 && abs(it.length-expected.length)<.08})
    }
    @Test fun blankFramesAndLargeBrightAreasAreNotStaffs(){
        val d=StaffDetector();assertTrue(d.detect(IntArray(w*h),w,h,Config()).isEmpty())
        assertTrue(d.detect(IntArray(w*h){0xffffffff.toInt()},w,h,Config()).isEmpty())
    }
    @Test fun crossingLedLinesAreSeparatelyDetected(){
        val x=Segment(P(.25,.25),P(1.05,.75));val y=Segment(P(.25,.75),P(1.05,.25))
        val result=StaffDetector().detect(frame(x to 0xffff4488.toInt(),y to 0xff44ffff.toInt()),w,h,Config())
        assertTrue(result.any{angleDifference(it.angle,x.angle)<.06});assertTrue(result.any{angleDifference(it.angle,y.angle)<.06})
    }
    @Test fun joinsLuminousHalvesAcrossALargeGripWithoutTrackingWindowEdges(){
        val left=Segment(P(.39,.5),P(.64,.5));val right=Segment(P(.86,.5),P(1.11,.5))
        val pixels=frame(left to 0xffff77dd.toInt(),right to 0xffff77dd.toInt())
        for(y in 0 until 170)for(x in 27..55)if(x<=30||y%24<3)pixels[y*w+x]=0xffffffff.toInt()
        val detected=StaffDetector().detect(pixels,w,h,Config(staffCount=1))
        assertEquals(1,detected.size);val s=detected.single()
        assertEquals(.75,s.center.x,.03);assertEquals(.5,s.center.y,.03);assertEquals(.72,s.length,.05)
    }
    @Test fun trackerDoesNotInventMissingMeasurements(){
        val t=StaffTracker();repeat(4){t.update(listOf(a,b),1000L+it*33)}
        assertEquals(2,t.update(listOf(a,b),1150).filterNotNull().count {it.confidence>=.55})
        assertTrue(t.update(emptyList(),1183).all {it!!.occluded && it.confidence<.55})
        assertTrue(t.update(emptyList(),3000).all {it==null})
    }
    @Test fun initialAndReacquiredTrackingNeedsEvidence(){
        val t=StaffTracker();assertTrue(t.update(listOf(a,b),1000).all{it!!.confidence<.55})
        t.update(listOf(a,b),1033);assertTrue(t.update(listOf(a,b),1066).all {it!!.confidence>=.55})
        t.update(emptyList(),1100);assertTrue(t.update(listOf(a,b),1133).all{it!!.confidence<.55})
    }
    @Test fun droppedFramesRequireFreshConfirmationEvenWithoutAMissingUpdate(){
        for(gap in listOf(300L,2000L,10000L)){
            val t=StaffTracker();repeat(3){t.update(listOf(a),1000L+it*17,1)}
            val time=1034L+gap
            // No empty update occurs while the camera/worker is stalled.
            assertTrue(t.update(listOf(a),time,1)[0]!!.confidence<.55)
            assertTrue(t.update(listOf(a),time+17,1)[0]!!.confidence<.55)
            assertTrue(t.update(listOf(a),time+34,1)[0]!!.confidence>=.55)
        }
    }
    @Test fun expiredIdentityCannotConfirmANewObjectOnItsFirstFrame(){
        val t=StaffTracker();repeat(3){t.update(listOf(a),1000L+it*17,1)}
        assertTrue(t.update(listOf(b),11000,1)[0]!!.confidence<.55)
    }
    @Test fun repeatedAndRewoundTimestampsCannotReuseConfirmation(){
        val established=StaffTracker();repeat(3){established.update(listOf(a),1000L+it*17,1)}
        assertTrue(established.hints(900,1).isEmpty())
        for(time in listOf(1034L,900L)){
            val t=StaffTracker();repeat(3){t.update(listOf(a),1000L+it*17,1)}
            assertTrue(t.update(listOf(a),time,1)[0]!!.confidence<.55)
            assertTrue(t.update(listOf(a),time+17,1)[0]!!.confidence<.55)
            assertTrue(t.update(listOf(a),time+34,1)[0]!!.confidence>=.55)
        }
        val t=StaffTracker();repeat(10){assertTrue(t.update(listOf(a),1000,1)[0]!!.confidence<.55)}
    }
    @Test fun briefBlurDoesNotForceClearAssociatedFramesToReconfirm(){
        val t=StaffTracker();repeat(3){t.update(listOf(a),1000L+it*17,1)}
        assertTrue(t.update(listOf(a.copy(blurred=true)),1051,1)[0]!!.confidence<.55)
        assertTrue(t.update(listOf(a),1068,1)[0]!!.confidence>=.55)
        repeat(20){assertTrue(t.update(listOf(a.copy(blurred=true)),1085L+it*17,1)[0]!!.confidence<.55)}
        assertTrue(t.update(listOf(a),1425,1)[0]!!.confidence<.55)
        t.update(listOf(a),1442,1);t.update(listOf(a),1459,1);t.update(emptyList(),1476,1)
        assertTrue(t.update(listOf(a),1493,1)[0]!!.confidence<.55)
        t.reset();assertTrue(t.update(listOf(a),1510,1)[0]!!.confidence<.55)
    }
    @Test fun manualSeedIsOnlyAPrior(){val t=StaffTracker();t.seed(listOf(a,b),1000);assertTrue(t.update(emptyList(),1033).all{it==null})}
    @Test fun duplicateCandidateCannotBecomeTwoStaves(){val t=StaffTracker();repeat(4){assertTrue(t.update(listOf(a,a),1000L+it*33).filterNotNull().size<=1)}}
    @Test fun metricRejectsMissingOrUncertainStaff(){
        val s=Scorer();val g=Guide(Config(),640,480)
        assertNull(s.score(1000,listOf(a,null),g).deviation)
        assertNull(s.score(1033,listOf(a,b.copy(confidence=.4)),g).deviation)
    }
    @Test fun gridAndMirrorMeasurementsHaveKnownZero(){
        val g=Guide(Config(diagonals=false),640,480)
        val a=Segment(g.point(-1.0,-1.0),g.point(-1.0,1.0));val b=Segment(g.point(1.0,-1.0),g.point(1.0,1.0))
        val m=Scorer().score(1000,listOf(a,b),g)
        assertEquals(0.0,m.deviation!!,1e-8);assertEquals(0.0,m.symmetry!!,1e-8);assertEquals(0.0,m.angle!!,1e-8)
    }
    @Test fun metricsUseSquarePixelsInPortraitAndLandscape(){
        for((w,h) in listOf(640 to 480,480 to 640)){val g=Guide(Config(mode="circles"),w,h);val c=g.circles.first();assertEquals(0.0,g.deviation(c+P(g.radius,0.0)),1e-9);assertEquals(0.0,g.deviation(c+P(0.0,g.radius)),1e-9)}
    }
    @Test fun cubeHasEightVerticesAndTwelveEdges(){val g=Guide(Config(mode="cube"),640,480);assertEquals(8,g.vertices.size);assertEquals(12,g.lines.size);g.vertices.forEach {assertEquals(0.0,g.deviation(it),1e-9)}}
    @Test fun staffAxisIsUndirected(){assertEquals(0.0,angleDifference(0.0,PI),1e-9);assertEquals(PI/4,angleDifference(0.0,PI/4),1e-9)}
    @Test fun staticStavesDoNotGetASpeedScore(){val s=Scorer();var m=Metrics();repeat(40){m=s.score(1000L+it*33,listOf(a,b),Guide(Config(),640,480))};assertNull(m.steadiness)}
    @Test fun invalidRemoteConfigIsRejected(){for(j in listOf(JSONObject().put("scale",-1),JSONObject().put("facing","other"),JSONObject().put("fps",45))){try{Config().patch(j);fail("accepted $j")}catch(_:IllegalArgumentException){}}}
}
