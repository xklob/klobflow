package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.*

class AntispinTest {
    private fun guide(rotation:Double=0.0,perspective:Boolean=false)=Guide(Config(mode="antispin",staffCount=1,scale=.3,rotation=rotation,tempoEnabled=true,
        planeCorners=if(perspective)listOf(P(.12,.1),P(.87,.16),P(.91,.9),P(.08,.81))else emptyList(),calibrationImageAspect=4.0/3),640,480)
    private fun pose(g:Guide,phase:Double,radius:Double=1.0)=Segment(g.project(g.point(radius*cos(phase),0.0)),g.project(g.point(0.0,radius*sin(phase))))

    @Test fun oneEndPerAxisAndShaftAngleIsNotAnError(){
        for(rotation in listOf(0.0,27.0))for(perspective in listOf(false,true)){
            val g=guide(rotation,perspective);val s=pose(g,.8)
            assertEquals(2,g.lines.size);assertTrue(g.circlePaths.isEmpty())
            assertEquals(0.0,Scorer().score(1000,listOf(s,null),g).deviation!!,1e-8)
            assertNull(Scorer().score(1000,listOf(s,null),g).angle)
            val off=Segment(g.project(g.point(.6,.1)),g.project(g.point(-.2,.8)))
            val cues=g.cues(listOf(off,null))
            assertEquals(listOf("horizontal","vertical"),cues.map {it.axis});assertEquals(5.0,cues[0].error,1e-7);assertEquals(10.0,cues[1].error,1e-7)
            val reversed=g.cues(listOf(off.reversed(),null));assertEquals("vertical",reversed[0].axis);assertEquals(10.0,reversed[0].error,1e-7)
            val flat=Segment(g.project(g.point(-.5,0.0)),g.project(g.point(.5,0.0)))
            assertEquals(25.0,g.cues(listOf(flat,null)).maxOf {it.error},1e-7)
            assertTrue(g.cues(listOf(Segment(g.project(g.point(1.3,0.0)),g.project(g.point(0.0,.5))),null)).any {!it.onTarget})
        }
        val g=guide();for(s in listOf<Segment?>(null,pose(g,.5).copy(blurred=true),pose(g,.5).copy(occluded=true),pose(g,.5).copy(confidence=.4))){
            assertTrue(g.cues(listOf(s,null)).isEmpty());assertNull(Scorer().score(1000,listOf(s,null),g).deviation)
        }
        val c=Config().patch(JSONObject().put("mode","antispin"));assertEquals(1,c.staffCount)
        assertEquals(1,c.patch(JSONObject().put("staffCount",2)).staffCount)
        assertEquals(1,Config().patch(c.json(),restore=true).staffCount)
    }
    @Test fun fourTurnaroundsHaveIndependentTimingAndPositionInBothDirections(){
        val g=guide(21.0,true)
        for(direction in listOf(-1,1))for(delay in listOf(-110.0,0.0,110.0)){
            val coach=TimingCoach();coach.reset(0.0);val events=linkedMapOf<Double,BeatHit>()
            for(t in 0L..4100L step 20){
                val s=pose(g,direction*(t-delay)*PI/1000,.75)
                val beat=coach.update(t,listOf(if(t%40==0L)s.reversed()else s,null),g)
                assertEquals(4,beat.targets[0].size);beat.hits[0]?.let {events[it.time]=it}
            }
            assertTrue(events.size>=7);assertEquals(setOf(1,2,3,4),events.values.map {it.point}.toSet())
            events.values.forEach {assertEquals(delay,it.offsetMs,1.0);assertEquals(12.5,it.error,.1)}
            assertNull(coach.update(4120,listOf(null,null),g).hits[0])
            assertNull(coach.update(4140,listOf(pose(g,.8),null),g).hits[0])
        }
        val coach=TimingCoach();repeat(30){assertNull(coach.update(it*33L,listOf(pose(g,.5),null),g).hits[0])}
    }
    @Test fun fitMatchesFullStaffLengthAndFullCycleCenter(){
        val g=guide();val f=FitHelper();f.begin();var result:JSONObject?=null
        for(i in 0..20)result=f.update(1000+i*100L,listOf(pose(g,i*2*PI/20),null),g,1.0,1.0,1.0) ?: result
        assertEquals(.3,result!!.getDouble("scale"),1e-8);assertEquals(.5,result!!.getDouble("cx"),1e-8);assertEquals(.5,result!!.getDouble("cy"),1e-8)
        f.begin(size=true);result=null
        for(i in 0..20)result=f.update(4000+i*100L,listOf(pose(g,.5),null),g,1.0,1.0,1.0) ?: result
        assertEquals(.3,result!!.getDouble("scale"),1e-8);assertFalse(result!!.has("cx"))
    }
    @Test fun axisFeedbackAveragesMeasuredFramesAndExpires(){
        val g=guide();val feedback=AlignmentFeedback()
        val s=Segment(g.point(.6,.1),g.point(-.2,.8))
        repeat(4){feedback.update(1000+it*20L,listOf(s,null),g)}
        val result=feedback.update(1100,listOf(pose(g,.5),null),g)
        assertTrue(result.summary!!.detail.contains("Horizontal tip: 4.0%"));assertTrue(result.summary!!.detail.contains("Vertical tip: 8.0%"))
        assertNull(feedback.update(7000,listOf(null,null),g).summary)
    }
    @Test fun sharedAntispinOracle(){
        val cases=JSONArray()
        for(rotation in listOf(0.0,23.0))for(perspective in listOf(false,true)){
            val g=guide(rotation,perspective);val coach=TimingCoach();coach.reset(0.0);val scorer=Scorer();val frames=JSONArray()
            for(t in 0L..3200L step 40){val staffs=if(t in 1300..1500)listOf(null,null)else listOf(pose(g,(t-80)*PI/1000,.9).let {if(t%80==0L)it.reversed()else it},null)
                frames.put(JSONObject().put("time",t).put("staffs",JSONArray(staffs.map {it?.json() ?: JSONObject.NULL})).put("metrics",scorer.score(t,staffs,g).json()).put("feedback",JSONArray(g.cues(staffs).map {it.json()})).put("beat",coach.update(t,staffs,g).json()))
            }
            cases.put(JSONObject().put("config",g.config.json()).put("guide",g.json()).put("frames",frames))
        }
        val file=File("../companion/test/fixtures/native-antispin.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(cases.toString(2)+"\n")
        assertEquals(BrowserParityTest().canonical(JSONArray(file.readText())),BrowserParityTest().canonical(cases))
    }
}
