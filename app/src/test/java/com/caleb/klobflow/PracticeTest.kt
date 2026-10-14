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
