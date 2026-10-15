package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test

class CapOcclusionTest {
    private fun sample(length:Double=1.0,weak:Double=8.0,strong:Double=8.0,peak:Double=255.0)=
        Segment(P(0.0,0.0),P(length,0.0),.8,capEvidence=CapEvidence(length*216,weak,strong,peak))
    private fun trained():CapOcclusionGuard=CapOcclusionGuard().also {g->repeat(30){g.update(sample(),it*17L)}}
    private fun trainedTracker():StaffTracker=StaffTracker().also {t->repeat(30){t.update(listOf(sample()),1000+it*17L,1)}}

    @Test fun learnedCapLossCannotBecomeATrustedShortStaff() {
        val guard=trained();val current=sample(.7,1.0,8.0)
        val output=guard.update(current,600)!!
        assertTrue(output.occluded);assertEquals(.35,output.confidence,0.0)
        assertSame(current.a,output.a);assertSame(current.b,output.b)
        assertFalse(current.occluded);assertEquals(.8,current.confidence,0.0)
        repeat(60){assertTrue(guard.update(current,617+it*17L)!!.occluded)}
    }
    @Test fun foreshorteningAndCapAsymmetryAloneDoNotTrigger() {
        val guard=trained()
        assertFalse(guard.update(sample(.6,5.0,6.0),600)!!.occluded)
        assertFalse(guard.update(sample(1.0,1.0,8.0),617)!!.occluded)
    }
    @Test fun twoClearCapPairsResumeMeasuredOutput() {
        val guard=trained();guard.update(sample(.7,1.0,8.0),600)
        assertTrue(guard.update(sample(.7,6.0,6.0),617)!!.occluded)
        assertFalse(guard.update(sample(.7,6.0,6.0),634)!!.occluded)
    }
    @Test fun missingSamplesBreakConsecutiveCapRestoration() {
        for(absent in listOf(null,sample(.7).copy(capEvidence=null))) {
            val guard=trained();guard.update(sample(.7,1.0,8.0),600)
            assertTrue(guard.update(sample(.7,6.0,6.0),617)!!.occluded)
            guard.update(absent,634)
            assertTrue(guard.update(sample(.7,6.0,6.0),651)!!.occluded)
            assertFalse(guard.update(sample(.7,6.0,6.0),668)!!.occluded)
        }
    }
    @Test fun uniformPropsAndChangingSaturatedColorsDoNotEstablishCapLoss() {
        val guard=CapOcclusionGuard();repeat(30){guard.update(sample(1.0,2.0,2.0),it*17L)}
        assertFalse(guard.update(sample(.7,1.0,8.0),600)!!.occluded)
        assertFalse(trained().update(sample(.7,0.0,8.0,200.0),600)!!.occluded)
        val uncertain=CapOcclusionGuard();repeat(30){uncertain.update(sample().copy(blurred=true),it*17L)}
        assertFalse(uncertain.update(sample(.7,1.0,8.0),600)!!.occluded)
    }
    @Test fun expiredAppearanceAndRewoundClocksCannotVetoANewObservation() {
        val guard=trained();guard.update(sample(.7,1.0,8.0),600)
        assertFalse(guard.update(sample(.7,1.0,8.0),5000)!!.occluded)
        assertFalse(trained().update(sample(.7,1.0,8.0),100)!!.occluded)
    }
    @Test fun rawCapEvidenceSurvivesReversalWithoutEnteringJson() {
        val w=100;val h=60;val pixels=IntArray(w*h)
        for(cx in listOf(20,80))for(y in 27..33)for(x in cx-3..cx+3)pixels[y*w+x]=-1
        val s=Segment(P(20.0/h,30.0/h),P(80.0/h,30.0/h),.8)
        val evidence=measureCapEvidence(pixels,w,h,s)!!
        assertEquals(evidence,measureCapEvidence(pixels,w,h,s.reversed()))
        assertEquals(255.0,evidence.neutralPeak,0.0)
        val annotated=s.copy(capEvidence=evidence)
        assertSame(evidence,annotated.reversed().capEvidence)
        assertEquals(s.json().toString(),annotated.json().toString())
        assertFalse(annotated.json().has("capEvidence"))
    }
    @Test fun gradualTruncationIsUncertainWithoutChangingDetectorHints() {
        val tracker=trainedTracker();var time=1510L
        for(length in listOf(.96,.92,.88,.84,.80)) {
            val current=sample(length,1.0,8.0);val actual=tracker.update(listOf(current),time,1)[0]!!
            assertEquals(current.a,actual.a);assertEquals(current.b,actual.b)
            if(length<.90){assertTrue(actual.occluded);assertEquals(.35,actual.confidence,0.0)}
            assertEquals(current.b,tracker.hints(time,1)[0].b);time+=17
        }
    }
    @Test fun resetSeedIdentityExpiryAndStaffCountChangeForgetTheGuard() {
        for(action in listOf("reset","seed","expired","count")) {
            val tracker=trainedTracker();assertTrue(tracker.update(listOf(sample(.8,1.0,8.0)),1510,1)[0]!!.occluded)
            var time=1527L;var count=1
            when(action){"reset"->tracker.reset();"seed"->tracker.seed(listOf(sample(.8,1.0,8.0)),1511);"expired"->time=4000;"count"->count=2}
            var actual:Segment?=null
            repeat(3){actual=tracker.update(listOf(sample(.8,1.0,8.0)),time+it*17,count)[0]}
            assertFalse(action,actual!!.occluded);assertTrue(action,actual!!.confidence>=.55)
        }
    }
    @Test fun uncertaintyBlocksMetricsAndDoesNotAwardHiddenStreakTime() {
        val tracker=StaffTracker();val streak=FlowStreak();val scorer=Scorer()
        val guide=Guide(Config(staffCount=1,tolerance=50.0),216,216);var flow=StreakFrame()
        fun update(time:Long,current:Segment):Metrics {
            val staffs=tracker.update(listOf(current),time,1)
            flow=streak.update(time,staffs,guide);return scorer.score(time,staffs,guide)
        }
        repeat(30){update(1000+it*17L,sample())};val earned=flow.seconds;assertTrue(earned>0)
        assertNull(update(1510,sample(.8,1.0,8.0)).deviation)
        assertEquals("held",flow.state);assertEquals(earned,flow.seconds,0.0)
        repeat(10){update(1527+it*17L,sample(.8,1.0,8.0))};assertEquals(earned,flow.seconds,0.0)
        assertNull(update(1697,sample(.8,7.0,7.0)).deviation)
        assertNotNull(update(1714,sample(.8,7.0,7.0)).deviation);assertEquals(earned,flow.seconds,0.0)
        update(1731,sample(.8,7.0,7.0));assertTrue(flow.seconds>earned)
    }
}
