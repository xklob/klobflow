package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test

class PacerIntegrationTest {
    private val config=Config(mode="circles",staffCount=1,pacerEnabled=true,pacerCountdown=0)
    private fun guide(c:Config=config)=Guide(c,640,480)
    private fun staff(g:Guide=guide())=Segment(g.center-P(g.radius,0.0),g.center+P(g.radius,0.0))
    private fun running(g:Guide=guide(),error:Double=0.0,elapsed:Double=0.0):PacerFrame {
        val s=staff(g)
        return PacerFrame(enabled=true,state="running",elapsedSeconds=elapsed,valid=true,onTarget=error<=g.config.tolerance,
            feedback=listOf(TipCue(s.a,s.a,error,error<=g.config.tolerance),TipCue(s.b,s.b,error,error<=g.config.tolerance)))
    }
    @Test fun sittingOnTheCircleCannotEarnMovingDotCreditOrChangeRawGeometry(){
        val g=guide();val s=staff(g);val coach=FlowStreak();val off=running(g,error=30.0)
        assertEquals(0.0,Scorer().score(0,listOf(s),g).deviation!!,1e-9)
        assertTrue(g.cues(listOf(s)).all {it.onTarget})
        for(t in 0L..1000L step 20){val f=coach.update(t,listOf(s),g,off);assertEquals(0.0,f.seconds,0.0);assertEquals("ready",f.state)}
        val feedback=AlignmentFeedback().update(0,listOf(s),g,pacer=off)
        assertEquals("FOLLOW THE DOTS",feedback.title);assertTrue(feedback.tips.all {it.error==30.0})
    }
    @Test fun movingCreditRequiresCurrentClearTipsAndExplicitRunningState(){
        val g=guide();val s=staff(g);val coach=FlowStreak();val pacer=running(g)
        for(t in 0L..1000L step 20)coach.update(t,listOf(s),g,pacer)
        assertEquals(1.0,coach.update(1020,listOf(s.copy(occluded=true)),g,pacer).seconds,0.0)
        assertEquals(1.0,coach.update(1040,listOf(s.copy(blurred=true)),g,pacer).seconds,0.0)
        assertEquals(1.0,coach.update(1060,listOf(s),g,pacer.copy(valid=false)).seconds,0.0)
        for(state in listOf("ready","countdown","paused")){
            val f=coach.update(1080,listOf(s),g,pacer.copy(state=state))
            assertEquals("practice",f.state);assertEquals(0.0,f.seconds,0.0);assertEquals(1.0,f.bestSeconds,0.0)
        }
        assertEquals("practice",coach.update(1100,listOf(s),g).state)
        assertEquals("off",coach.update(1120,listOf(s),guide(config.copy(streakEffects=false)),pacer).state)
        assertEquals("free",coach.update(1140,listOf(s),guide(config.copy(mode="free")),pacer).state)
    }
    @Test fun cosmeticDotsPreserveStreakButPacingChangesResetIt(){
        val coach=FlowStreak();val g=guide();val s=staff(g);val pacer=running(g)
        for(t in 0L..1000L step 20)coach.update(t,listOf(s),g,pacer)
        val cosmetic=guide(config.copy(pacerDotSize=24.0))
        assertEquals(1.02,coach.update(1020,listOf(s),cosmetic,pacer).seconds,1e-9)
        val changed=coach.update(1040,listOf(s),guide(config.copy(pacerRpm=30.0)),pacer)
        assertEquals(0.0,changed.seconds,0.0);assertEquals(0.0,changed.bestSeconds,0.0)
    }
    @Test fun idleExerciseIsNeutralEvenWithNoStaffAndNeverUsesStaticFeedback(){
        val g=guide();val coach=AlignmentFeedback()
        for((state,title) in listOf("ready" to "READY TO FOLLOW","countdown" to "GET READY","paused" to "GUIDE DOTS PAUSED")){
            val f=coach.update(100,listOf(null),g,pacer=PacerFrame(enabled=true,state=state))
            assertEquals("practice",f.state);assertEquals(title,f.title);assertEquals("wait",f.tracking.tone)
            assertFalse(f.trackingConfirmed);assertTrue(f.tips.isEmpty());assertNull(f.summary)
        }
        assertEquals("READY TO FOLLOW",coach.update(200,listOf(staff(g)),g).title)
    }
    @Test fun summariesUseMovingFeedbackAndRestartClearsTheirHistory(){
        val g=guide();val s=staff(g);val coach=AlignmentFeedback();var f=Coaching("","","")
        for(t in 0L..2000L step 20)f=coach.update(t,listOf(s),g,pacer=running(g,elapsed=t/1000.0))
        assertEquals("WITH THE DOTS",f.title);assertEquals("100% WITH DOTS",f.summary!!.title)
        val hidden=coach.update(2020,listOf(s.copy(occluded=true)),g,pacer=running(g,elapsed=2.02).copy(valid=false,feedback=emptyList()))
        assertFalse(hidden.trackingConfirmed);assertTrue(hidden.tips.isEmpty());assertEquals("100% WITH DOTS",hidden.summary!!.title)
        val restarted=coach.update(2040,listOf(s),g,pacer=running(g,elapsed=0.0))
        assertNull(restarted.summary);assertEquals("TIPS WITH DOTS",restarted.title)
        assertTrue(restarted.tips.none {it.onTarget})
    }
    @Test fun serializedFrameUsesExerciseCuesAndPreservesGeometricMetrics(){
        val g=guide();val s=staff(g);val metrics=Scorer().score(0,listOf(s),g)
        val base=Frame(0,640,480,listOf(s),metrics,g,30.0,"test")
        assertEquals(2,base.json().getJSONArray("feedback").length())
        val ready=base.copy(pacer=PacerFrame(enabled=true,state="ready")).json()
        assertEquals(0,ready.getJSONArray("feedback").length());assertEquals("ready",ready.getJSONObject("pacer").getString("state"))
        val running=base.copy(pacer=running(g,error=30.0)).json()
        assertEquals(30.0,running.getJSONArray("feedback").getJSONObject(0).getDouble("error"),0.0)
        assertEquals(0.0,running.getJSONObject("metrics").getDouble("deviation"),1e-9)
    }
}
