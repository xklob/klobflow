package com.caleb.klobflow
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import kotlin.math.*

class PracticeTest {
    private fun spin(g:Guide,t:Long,delay:Double=0.0,radius:Double=g.radius):Segment {val a=(t-1500-delay)*PI/1000;val d=P(cos(a),sin(a))*radius;return Segment(g.center+d,g.center-d)}
    @Test fun beatTimingSeparatesEarlyLateFromPositionAndRejectsMissing(){
        val g=Guide(Config(mode="circles",staffCount=1,tempoEnabled=true),640,480)
        for(delay in listOf(-100.0,0.0,100.0)){
            val coach=TimingCoach();coach.reset(0.0);var result=BeatFrame()
            for(t in 1250L..1700L step 20)result=coach.update(t,listOf(spin(g,t,delay),null),g)
            assertNotNull(result.hits[0]);assertEquals(delay,result.hits[0]!!.offsetMs,1.0);assertTrue(result.hits[0]!!.error<.1)
            assertNull(coach.update(1733,listOf(null,null),g).hits[0])
        }
        val coach=TimingCoach();coach.reset(0.0);var result=BeatFrame()
        for(t in 1250L..1700L step 20)result=coach.update(t,listOf(spin(g,t,radius=g.radius*.6),null),g)
        assertEquals(0.0,result.hits[0]!!.offsetMs,1.0);assertEquals(20.0,result.hits[0]!!.error,.1)
    }
    @Test fun singleStaffHasScoresTwoCuesAndNoSymmetry(){
        val g=Guide(Config(staffCount=1),640,480);val s=Segment(g.point(-1.0,-1.0),g.point(-1.0,1.0))
        val m=Scorer().score(1000,listOf(s,null),g);assertEquals(0.0,m.deviation!!,1e-8);assertNull(m.symmetry);assertEquals(2,g.cues(listOf(s,null)).size)
        val tracker=StaffTracker();repeat(5){assertNull(tracker.update(listOf(s,s.copy(a=s.a+P(.4,0.0),b=s.b+P(.4,0.0))),1000L+it*33,1)[1])}
    }
    @Test fun fitRequiresVisibleEvidenceAndMatchesStaffSize(){
        val g=Guide(Config(mode="circles",staffCount=1),640,480);val s=Segment(P(.3,.35),P(.7,.35));val f=FitHelper();f.begin(size=true)
        repeat(20){assertNull(f.update(1000L+it*100,listOf(s.copy(confidence=.3),null),g,1.0,8.0,1.0))}
        var result:JSONObject?=null;repeat(22){result=f.update(4000L+it*100,listOf(s,null),g,1.0,8.0,1.0) ?: result}
        assertEquals(.2,result!!.getDouble("scale"),1e-9);assertFalse(result!!.has("cx"));assertFalse(f.active)
    }
    @Test fun fittingKeepsTheFullIntervalAtEveryFrameRate(){
        val g=Guide(Config(mode="antispin",staffCount=1,scale=.3),640,480)
        for(fps in listOf(30,60,120)){
            val fit=FitHelper();fit.begin();var result:JSONObject?=null
            for(i in 0..fps*2){
                val phase=PI/4+i*PI/fps
                val s=Segment(g.point(cos(phase),0.0),g.point(0.0,sin(phase)))
                result=fit.update((i*1000.0/fps).roundToLong(),listOf(s,null),g,1.0,1.0,1.0) ?: result
            }
            assertNotNull("Fit did not complete at $fps fps",result)
            assertEquals(.5,result!!.getDouble("cx"),1e-8);assertEquals(.5,result!!.getDouble("cy"),1e-8)
            assertEquals(.3,result!!.getDouble("scale"),1e-8)
        }
    }
    @Test fun fittingRestartsAfterStallsOrBackwardTime(){
        val g=Guide(Config(mode="circles",staffCount=1),640,480);val s=Segment(P(.3,.4),P(.7,.4))
        for(restart in listOf(500L,5000L)){
            val fit=FitHelper();fit.begin()
            repeat(12){assertNull(fit.update(1000+it*17L,listOf(s,null),g,1.0,1.0,1.0))}
            assertNull(fit.update(restart,listOf(s,null),g,1.0,1.0,1.0))
            repeat(19){assertNull(fit.update(restart+(it+1)*100L,listOf(s,null),g,1.0,1.0,1.0))}
            assertNotNull(fit.update(restart+2000,listOf(s,null),g,1.0,1.0,1.0))
        }
    }
    @Test fun cosmeticConfigPreservesBeatSyncAndGeometryOnlyDropsCrossings(){
        val c=Config(mode="circles",staffCount=1,tempoEnabled=true);val g=Guide(c,640,480)
        val coach=TimingCoach();coach.reset(0.0);var before=BeatFrame()
        for(t in 1250L..1700L step 20)before=coach.update(t,listOf(spin(g,t),null),g)
        assertNotNull(before.hits[0])
        val display=c.copy(trails=false,showGuide=false,showFeedback=false,streakEffects=false,tolerance=8.0,timing="split-opp",ratio="1:3",symmetry=false)
        coach.reconfigure(c,display)
        val after=coach.update(1710,listOf(spin(g,1710),null),Guide(display,640,480))
        assertEquals(.42,after.phase,1e-8);assertEquals(before.hits[0],after.hits[0])
        val geometry=display.copy(scale=.4);coach.reconfigure(display,geometry)
        val moved=coach.update(1750,listOf(spin(g,1750),null),Guide(geometry,640,480))
        assertEquals(.5,moved.phase,1e-8);assertNull(moved.hits[0])
        val clock=geometry.copy(bpm=90.0);coach.reconfigure(geometry,clock)
        assertEquals(0.0,coach.update(1760,listOf(spin(g,1760),null),Guide(clock,640,480)).phase,0.0)
    }
    @Test fun browserPracticeOracle(){
        val g=Guide(Config(mode="circles",staffCount=1,tempoEnabled=true),640,480);val coach=TimingCoach();coach.reset(0.0)
        val timing=JSONArray();for(t in 1250L..2700L step 40){val staffs=if(t in 1800..1950)listOf(null,null)else listOf(spin(g,t,80.0),null);timing.put(JSONObject().put("time",t).put("staffs",JSONArray(staffs.map {it?.json() ?: JSONObject.NULL})).put("beat",coach.update(t,staffs,g).json()))}
        val f=FitHelper();f.begin(zoom=true);val staff=Segment(P(.3,.3),P(.7,.3));var fit:JSONObject?=null
        repeat(22){fit=f.update(1000L+it*100,listOf(staff,null),g,1.0,8.0,1.0) ?: fit}
        val value=JSONObject().put("config",g.config.json()).put("timing",timing).put("fit",fit).put("fitStaff",staff.json())
        val file=File("../companion/test/fixtures/native-practice.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(value.toString(2)+"\n")
        // Compare numeric fixture behavior in the Node suite; native tests above assert independent expected values.
        assertEquals(BrowserParityTest().canonical(JSONObject(file.readText())),BrowserParityTest().canonical(value))
    }
}
