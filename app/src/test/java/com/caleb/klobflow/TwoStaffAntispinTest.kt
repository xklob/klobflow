package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.*

class TwoStaffAntispinTest {
    private fun config()=Config(mode="antispin",staffCount=2,scale=.2,circleSeparation=1.4,tempoEnabled=true)
    private fun pose(g:Guide,index:Int,phase:Double,r:Double=1.0)=Segment(g.project(g.antispinPoint(r*cos(phase),0.0,index)),g.project(g.antispinPoint(0.0,r*sin(phase),index)))

    @Test fun eachStaffMustUseItsOwnCrossAndBothMustBeMeasured(){
        val g=Guide(config(),640,480);val a=pose(g,0,.8);val b=pose(g,1,-.8)
        assertEquals(4,g.lines.size)
        assertEquals(listOf("horizontal","vertical","horizontal","vertical"),g.cues(listOf(a,b)).map {it.axis})
        assertEquals(0.0,Scorer().score(0,listOf(a,b),g).deviation!!,1e-8)
        assertTrue(Scorer().score(0,listOf(b,a),g).deviation!!>10)
        val off=Segment(g.antispinPoint(.6,.2,1),g.antispinPoint(.1,.8,1))
        assertEquals(listOf(0.0,0.0,10.0,5.0),g.cues(listOf(a,off)).map {round(it.error*1e6)/1e6})
        val feedback=AlignmentFeedback();var result=Coaching("","","")
        repeat(3){result=feedback.update(it*20L,listOf(a,off),g)}
        assertTrue(result.summary!!.detail.contains("Horizontal tips (A+B): 5.0%"))
        assertTrue(result.summary!!.detail.contains("Vertical tips (A+B): 2.5%"))
        for(bad in listOf<Segment?>(null,b.copy(blurred=true),b.copy(occluded=true),b.copy(confidence=.4))){
            assertTrue(g.cues(listOf(a,bad)).isEmpty());assertNull(Scorer().score(0,listOf(a,bad),g).deviation)
        }
        val overlap=Guide(config().copy(circleSeparation=0.0),640,480)
        assertEquals(overlap.lines.take(2),overlap.lines.drop(2))
    }

    @Test fun bothClocksUseTheirOwnCrossAndHiddenBDoesNotCreateABeat(){
        val g=Guide(config().copy(rotation=23.0),640,480);val coach=TimingCoach();coach.reset(0.0)
        val events=List(2){linkedMapOf<Double,BeatHit>()}
        for(t in 0L..4100L step 20){
            val beat=coach.update(t,listOf(pose(g,0,t*PI/1000),pose(g,1,-(t-110)*PI/1000,.75).reversed()),g)
            assertEquals(listOf(4,4),beat.targets.map {it.size})
            beat.hits.forEachIndexed {i,hit->if(hit!=null)events[i][hit.time]=hit}
        }
        events.forEach {assertTrue(it.size>=7);assertEquals(setOf(1,2,3,4),it.values.map {h->h.point}.toSet())}
        events[0].values.forEach {assertEquals(0.0,it.offsetMs,1.0);assertEquals(0.0,it.error,.1)}
        events[1].values.forEach {assertEquals(110.0,it.offsetMs,1.0);assertEquals(12.5,it.error,.1)}
        assertNull(coach.update(4120,listOf(pose(g,0,4.12*PI),null),g).hits[1])
    }

    @Test fun fullCycleFitRecoversBothCrossCentersAndSizeOnlyPreservesLayout(){
        val actual=Guide(config().copy(cx=.55,cy=.45,rotation=27.0),640,480)
        val initial=Guide(config().copy(scale=.32,circleSeparation=1.0,rotation=27.0),640,480)
        val fit=FitHelper();fit.begin();var patch:JSONObject?=null
        for(i in 0..20)patch=fit.update(i*100L,listOf(pose(actual,0,i*PI/10),pose(actual,1,-i*PI/10+PI/2)),initial,1.0,1.0,1.0) ?: patch
        assertEquals(.2,patch!!.getDouble("scale"),1e-8);assertEquals(.55,patch!!.getDouble("cx"),1e-8)
        assertEquals(.45,patch!!.getDouble("cy"),1e-8);assertEquals(1.4,patch!!.getDouble("circleSeparation"),1e-8)
        fit.begin(size=true);patch=null
        for(i in 0..20)patch=fit.update(3000+i*100L,listOf(pose(actual,0,.8),pose(actual,1,.3)),initial,1.0,1.0,1.0) ?: patch
        assertEquals(.2,patch!!.getDouble("scale"),1e-8);assertFalse(patch!!.has("cx"));assertFalse(patch!!.has("circleSeparation"))
    }

    @Test fun allFourMovingTargetsScoreAndKeepRigidLengthAcrossPatterns(){
        for(pattern in listOf("same","opposite"))for(offset in listOf(0.0,90.0,180.0))for(direction in listOf("cw","ccw")){
            val g=Guide(config().copy(pacerEnabled=true,pacerCountdown=0,pacerRpm=30.0,pacerPattern=pattern,pacerOffset=offset,pacerDirection=direction,rotation=23.0),640,480)
            val p=MovingPacer();p.command("start",0,g)
            for(t in 0L..2000L step 100){
                val theta=t*PI/1000*(if(direction=="cw")1 else -1)
                val staffs=listOf(pose(g,0,theta).reversed(),pose(g,1,theta*(if(pattern=="same")1 else -1)+Math.toRadians(offset)))
                val f=p.update(t,staffs,g);assertTrue(f.onTarget);assertEquals(4,f.feedback.size)
                f.targets.forEach {assertEquals(g.radius,it[0].distance(it[1]),1e-8)}
            }
            val missing=p.update(2020,listOf(pose(g,0,0.0),null),g)
            assertFalse(missing.valid);assertFalse(missing.onTarget);assertEquals(2,missing.targets.size)
            val wrong=p.update(2040,listOf(pose(g,0,0.0),pose(g,0,0.0)),g)
            assertTrue(wrong.valid);assertFalse(wrong.onTarget)
        }
    }

    @Test fun sharedTwoStaffOracleIncludesPerspectiveGapsAndEndpointSwaps(){
        val cases=JSONArray()
        for(perspective in listOf(false,true))for(pattern in listOf("same","opposite")){
            val c=config().copy(rotation=23.0,pacerEnabled=true,pacerCountdown=0,pacerRpm=30.0,pacerPattern=pattern,pacerOffset=90.0,
                planeCorners=if(perspective)listOf(P(.12,.1),P(.87,.16),P(.91,.9),P(.08,.81))else emptyList(),calibrationImageAspect=4.0/3)
            val g=Guide(c,640,480);val p=MovingPacer();p.command("start",0,g);val coach=TimingCoach();coach.reset(0.0);val scorer=Scorer();val frames=JSONArray()
            for(t in 0L..2400L step 40){
                val staffs=listOf(pose(g,0,t*PI/1000).let {if(t%80==0L)it.reversed()else it},
                    if(t in 1000..1200)null else pose(g,1,t*PI/1000*(if(pattern=="same")1 else -1)+PI/2,.9).let {if(t==1600L)it.copy(occluded=true)else it})
                frames.put(JSONObject().put("time",t).put("staffs",JSONArray(staffs.map {it?.json() ?: JSONObject.NULL}))
                    .put("feedback",JSONArray(g.cues(staffs).map {it.json()})).put("metrics",scorer.score(t,staffs,g).json()).put("beat",coach.update(t,staffs,g).json()).put("pacer",p.update(t,staffs,g).json()))
            }
            cases.put(JSONObject().put("config",c.json()).put("guide",g.json()).put("frames",frames))
        }
        val file=File("../companion/test/fixtures/native-two-staff-antispin.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(cases.toString()+"\n")
        assertEquals(BrowserParityTest().canonical(JSONArray(file.readText())),BrowserParityTest().canonical(cases))
    }
}
