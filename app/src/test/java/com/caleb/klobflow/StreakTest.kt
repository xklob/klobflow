package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToLong

class StreakTest {
    private val config=Config(staffCount=1,mode="circles",scale=.23)
    private fun guide(c:Config=config)=Guide(c,640,480)
    private fun staff(g:Guide=guide())=Segment(g.point(-1.0,0.0),g.point(1.0,0.0))
    private fun build(coach:FlowStreak,end:Long=1000,g:Guide=guide()):StreakFrame {
        var f=StreakFrame();for(t in 0L..end step 20)f=coach.update(t,listOf(staff(g),null),g);return f
    }
    @Test fun sustainedAlignmentUsesElapsedTimeAtThirtyAndSixtyFps(){
        for(fps in listOf(30,60)){
            val coach=FlowStreak();val g=guide();var f=StreakFrame()
            for(i in 0..fps*10){f=coach.update((i*1000.0/fps).roundToLong(),listOf(staff(g),null),g)
                if(i==fps*2)assertEquals(2,f.level);if(i==fps*5)assertEquals(3,f.level)}
            assertEquals(10.0,f.seconds,1e-9);assertEquals(4,f.level);assertEquals(1.0,f.progress,1e-9);assertTrue(f.energy>.95)
        }
    }
    @Test fun blurPausesWithoutAwardingHiddenTimeAndExpires(){
        val coach=FlowStreak();val g=guide();val s=staff(g);build(coach)
        val blurred=coach.update(1020,listOf(s.copy(blurred=true),null),g)
        assertEquals("held",blurred.state);assertEquals(1.0,blurred.seconds,0.0)
        assertEquals(1.0,coach.update(1200,listOf(s,null),g).seconds,0.0)
        assertEquals(1.02,coach.update(1220,listOf(s,null),g).seconds,1e-9)
        coach.update(1240,listOf(s.copy(occluded=true),null),g)
        for(t in 1400L..2800L step 200)coach.update(t,listOf(null,null),g)
        assertEquals(0.0,coach.update(2820,listOf(s,null),g).seconds,0.0)
        assertEquals(1.02,coach.update(2840,listOf(s,null),g).bestSeconds,1e-9)
    }
    @Test fun behindTheBackPassHoldsEarnedGlowWithoutUnseenPrecisionOrTime(){
        val coach=FlowStreak();val g=guide();val s=staff(g);val hidden=s.copy(occluded=true,confidence=.3);build(coach)
        val before=coach.update(1020,listOf(hidden,null),g)
        for(t in 1040L..2400L step 20){
            val held=coach.update(t,listOf(hidden,null),g)
            assertEquals("held",held.state);assertEquals(1.0,held.seconds,0.0);assertEquals(before.energy,held.energy,0.0)
            assertNull(Scorer().score(t,listOf(hidden,null),g).deviation)
        }
        assertEquals(1.0,coach.update(2420,listOf(s,null),g).seconds,0.0)
        assertEquals(1.02,coach.update(2440,listOf(s,null),g).seconds,1e-9)
        coach.update(2460,listOf(hidden,null),g)
        val off=coach.update(2480,listOf(s.copy(a=g.point(-1.3,0.0)),null),g)
        assertEquals("recovering",off.state);assertEquals(1.02,off.seconds,1e-9)
        assertEquals("ready",coach.update(2680,listOf(s.copy(a=g.point(-1.3,0.0)),null),g).state)
    }
    @Test fun everySelectedTipMustBeClearAndWithinTolerance(){
        val g=guide(Config(mode="grid",staffCount=2));val a=Segment(g.point(-1.0,-1.0),g.point(-1.0,1.0));val b=Segment(g.point(1.0,-1.0),g.point(1.0,1.0));val coach=FlowStreak()
        coach.update(0,listOf(a,b),g);assertEquals(.1,coach.update(100,listOf(a,b),g).seconds,0.0)
        // Only one of four tips is off guide. RMS would still be within tolerance.
        val off=b.copy(b=g.point(1.12,1.0))
        assertTrue(Scorer().score(200,listOf(a,off),g).deviation!!<g.config.tolerance)
        assertEquals("recovering",coach.update(200,listOf(a,off),g).state)
        assertEquals(.1,coach.update(220,listOf(a,null),g).seconds,0.0)
        assertEquals(.1,coach.update(240,listOf(a,b.copy(confidence=.54)),g).seconds,0.0)
        assertEquals("paused",coach.update(420,listOf(a,null),g).state)
    }
    @Test fun targetsFreeModeAndEffectSwitchCannotCarryCredit(){
        val coach=FlowStreak();build(coach)
        assertEquals(0.0,coach.update(1020,listOf(staff(),null),guide(config.copy(cx=.52))).seconds,0.0)
        assertEquals("free",coach.update(1040,listOf(staff(),null),guide(config.copy(mode="free"))).state)
        val off=coach.update(1060,listOf(staff(),null),guide(config.copy(streakEffects=false)))
        assertEquals("off",off.state);assertEquals(0.0,off.energy,0.0)
        val cube=guide(config.copy(mode="cube"));val s=Segment(cube.vertices[0],cube.vertices[2])
        coach.update(1080,listOf(s,null),cube);assertEquals("building",coach.update(1100,listOf(s,null),cube).state)
    }
    @Test fun suspendedFramesAndSeekingCannotInventTime(){
        val coach=FlowStreak();build(coach);val g=guide();val s=staff(g)
        val resumed=coach.update(2000,listOf(s,null),g);assertEquals(0.0,resumed.seconds,0.0);assertEquals(1.0,resumed.bestSeconds,0.0)
        val seek=coach.update(0,listOf(s,null),g);assertEquals(0.0,seek.seconds,0.0);assertEquals(0.0,seek.bestSeconds,0.0)
    }
    @Test fun changingLedFilterClearsCreditFromPreviousDetections(){
        val coach=FlowStreak();build(coach)
        val result=coach.update(1020,listOf(staff(),null),guide(config.copy(staffColors=listOf("pink"))))
        assertEquals(0.0,result.seconds,0.0);assertEquals(0.0,result.bestSeconds,0.0)
    }
    @Test fun briefOffTargetBlipFreezesTimeWithoutChangingPrecision(){
        val coach=FlowStreak();val g=guide();build(coach);val off=staff(g).copy(a=g.point(-1.3,0.0))
        val before=coach.update(1020,listOf(off,null),g)
        assertEquals("recovering",before.state);assertEquals(1.0,before.seconds,0.0)
        assertTrue(Scorer().score(1020,listOf(off,null),g).deviation!!>config.tolerance);assertFalse(g.cues(listOf(off,null))[0].onTarget)
        val held=coach.update(1140,listOf(off,null),g);assertEquals(1.0,held.seconds,0.0);assertEquals(before.energy,held.energy,0.0)
        assertEquals(1.0,coach.update(1180,listOf(staff(g),null),g).seconds,0.0)
        assertEquals(1.02,coach.update(1200,listOf(staff(g),null),g).seconds,1e-9)
    }
    @Test fun zeroIsStrictAndMaximumTrackingGraceOnlyPreservesEarnedTime(){
        for(hidden in listOf(true,false)){
            val coach=FlowStreak();val g=guide(config.copy(trackingGraceMs=0,alignmentGraceMs=0));build(coach,g=g)
            val bad=if(hidden)null else staff(g).copy(a=g.point(-1.3,0.0))
            assertEquals(0.0,coach.update(1020,listOf(bad,null),g).seconds,0.0)
        }
        val coach=FlowStreak();val g=guide(config.copy(trackingGraceMs=3000));build(coach,g=g)
        for(t in 1020L..4020L step 20){val f=coach.update(t,listOf(null,null),g);assertEquals("held",f.state);assertEquals(1.0,f.seconds,0.0)}
        assertEquals(0.0,coach.update(4040,listOf(staff(g),null),g).seconds,0.0)
    }
    @Test fun alternatingInterruptionsCannotRestartForgivenessOrAddTime(){
        val coach=FlowStreak();val g=guide();build(coach);val off=staff(g).copy(a=g.point(-1.3,0.0))
        assertEquals(1.0,coach.update(1020,listOf(off,null),g).seconds,0.0)
        for(t in 1040L..1220L step 20)assertEquals(1.0,coach.update(t,listOf(if(t%40L!=0L)off else null,null),g).seconds,0.0)
        assertEquals(0.0,coach.update(1240,listOf(null,null),g).seconds,0.0)
        assertEquals(0.0,coach.update(1260,listOf(staff(g),null),g).seconds,0.0)
        assertEquals(.02,coach.update(1280,listOf(staff(g),null),g).seconds,1e-9)
    }
    @Test fun forgivenessSettingsRoundTripValidateAndRestoreDefaults(){
        val c=config.patch(JSONObject().put("trackingGraceMs",3000).put("alignmentGraceMs",1000))
        assertEquals(c,Config().patch(c.json(),restore=true))
        val legacy=config.json().apply {remove("trackingGraceMs");remove("alignmentGraceMs")}
        val restored=Config().patch(legacy,restore=true);assertEquals(1500,restored.trackingGraceMs);assertEquals(200,restored.alignmentGraceMs)
        for((key,maximum) in listOf("trackingGraceMs" to 3000,"alignmentGraceMs" to 1000))for(value in listOf(-1.0,maximum+1.0,.5)){
            try{config.patch(JSONObject().put(key,value));fail("Accepted invalid $key=$value")}catch(expected:IllegalArgumentException){/* rejected */}
        }
    }
    @Test fun nativeStreakOracleMatchesBrowserFixture(){
        val coach=FlowStreak();val g=guide();val s=staff(g)
        val steps=JSONArray()
        for(t in 0L..12400L step 100){
            val staves=listOf(when {
                t==3000L||t==3100L->s.copy(a=g.point(-1.3,0.0))
                t==10200L||t in 10500L..12100L->s.copy(blurred=true)
                else->s
            },null)
            val currentGuide=if(t>=12300)guide(config.copy(streakEffects=false))else g
            steps.put(JSONObject().put("time",t).put("config",currentGuide.config.json()).put("staffs",JSONArray(staves.map {it?.json()?:JSONObject.NULL})).put("output",coach.update(t,staves,currentGuide).json()))
        }
        val fixture=JSONObject().put("steps",steps);val file=File("../companion/test/fixtures/native-streak.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(fixture.toString(2)+"\n")
        assertEquals(BrowserParityTest().canonical(JSONObject(file.readText())),BrowserParityTest().canonical(fixture))
    }
}
