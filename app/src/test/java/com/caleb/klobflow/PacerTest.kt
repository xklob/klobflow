package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.*

class PacerTest {
    private fun config()=Config(mode="circles",staffCount=1,pacerEnabled=true,pacerCountdown=0,pacerRpm=30.0)
    private fun guide(c:Config=config())=Guide(c,640,480)
    private fun poses(g:Guide,phase:Double,shift:Double=0.0):List<Segment> {
        val c=g.config;val theta=(if(c.pacerDirection=="cw")1 else -1)*2*PI*phase
        val pairs=if(c.mode=="antispin")listOf(listOf(g.point(cos(theta),0.0),g.point(0.0,sin(theta))))else g.circles.mapIndexed {i,center->
            val a=theta*(if(i==1 && c.pacerPattern=="opposite")-1 else 1)+Math.toRadians(c.rotation+(if(i==1)c.pacerOffset else 0.0))
            val delta=P(cos(a),sin(a))*g.radius;listOf(center+delta,center-delta)
        }
        return pairs.map {Segment(g.project(it[0]+P(shift,0.0)),g.project(it[1]+P(shift,0.0)),.9)}
    }
    @Test fun configurationValidatesAndOlderSettingsStayStopped() {
        val legacy=Config().json();legacy.keys().asSequence().toList().filter {it.startsWith("pacer")}.forEach(legacy::remove)
        val restored=Config().patch(legacy,restore=true);assertFalse(restored.pacerEnabled);assertEquals(20.0,restored.pacerRpm,0.0);assertEquals(3,restored.pacerCountdown)
        val c=config().copy(pacerRpm=22.5,pacerDirection="ccw",pacerPattern="same",pacerOffset=90.0,pacerDotSize=24.0)
        assertEquals(c,Config().patch(c.json(),restore=true))
        for((key,value)in listOf("pacerEnabled" to "true","pacerRpm" to 4,"pacerRpm" to 121,"pacerRpm" to "20","pacerCountdown" to 1.5,"pacerCountdown" to 11,"pacerDotSize" to 7,"pacerDotSize" to 29,"pacerOffset" to 181,"pacerDirection" to "left","pacerPattern" to "split")){
            try{Config().patch(JSONObject().put(key,value));fail("accepted $key=$value")}catch(_:IllegalArgumentException){}
        }
    }
    @Test fun startupRequiresAnExplicitStartAndUnsupportedModesStayOff() {
        val g=guide();val p=MovingPacer();val ready=p.update(0,poses(g,0.0),g)
        assertEquals("ready",ready.state);assertEquals(1,ready.targets.size);assertFalse(ready.valid);assertNull(ready.meanError)
        assertEquals(0.0,p.update(500,emptyList(),g).phase,0.0)
        p.command("start",500,g);assertTrue(p.update(500,poses(g,0.0),g).onTarget)
        p.reset();assertEquals("ready",p.update(600,emptyList(),g).state)
        for(c in listOf(config().copy(pacerEnabled=false),config().copy(mode="grid"),config().copy(mode="free"))){
            val off=guide(c);val f=p.update(700,emptyList(),off);assertEquals("off",f.state);assertTrue(f.targets.isEmpty())
            try{p.command("start",700,off);fail("started disabled/unsupported exercise")}catch(_:IllegalArgumentException){}
        }
        try{p.command("unknown",700,g);fail("accepted unknown command")}catch(_:IllegalArgumentException){}
    }
    @Test fun frameRateDoesNotChangeSpeedAndDirectionUsesPreviewCoordinates() {
        for(fps in listOf(30,60,120)){
            val p=MovingPacer();val g=guide();p.command("start",0,g);var frame=PacerFrame()
            for(i in 0..fps*3/2)frame=p.update((i*1000.0/fps).roundToLong(),emptyList(),g)
            assertEquals(.75,frame.phase,1e-9);assertEquals(1.5,frame.elapsedSeconds,1e-9)
        }
        for(direction in listOf("cw","ccw"))for(pattern in listOf("same","opposite")){
            val g=guide(config().copy(staffCount=2,pacerDirection=direction,pacerPattern=pattern,pacerOffset=90.0));val p=MovingPacer();p.command("start",0,g)
            val frame=p.update(500,emptyList(),g);val sign=if(direction=="cw")1 else -1
            assertEquals(0.0,frame.targets[0][0].distance(g.circles[0]+P(0.0,sign*g.radius)),1e-8)
            val a=sign*PI/2*(if(pattern=="opposite")-1 else 1)+PI/2
            assertEquals(0.0,frame.targets[1][0].distance(g.circles[1]+P(cos(a),sin(a))*g.radius),1e-8)
        }
    }
    @Test fun rigidPairsAndScoringSurviveRotationPerspectiveAndEndpointReversal() {
        for(mode in listOf("circles","antispin"))for(perspective in listOf(false,true)){
            val c=config().copy(mode=mode,rotation=23.0,planeCorners=if(perspective)listOf(P(.12,.1),P(.87,.16),P(.91,.9),P(.08,.81))else emptyList(),calibrationImageAspect=4.0/3)
            val g=guide(c);val p=MovingPacer();p.command("start",0,g)
            for(t in 0L..2000L step 100){
                val frame=p.update(t,poses(g,(t/2000.0)%1).map {it.reversed()},g);assertTrue(frame.valid);assertTrue(frame.onTarget)
                val pair=g.rectify(Segment(frame.targets[0][0],frame.targets[0][1]))!!
                assertEquals(g.radius*(if(mode=="circles")2 else 1),pair.length,1e-8)
                if(mode=="antispin"){assertEquals(0.0,g.local(pair.a).y,1e-8);assertEquals(0.0,g.local(pair.b).x,1e-8);assertEquals(listOf("vertical","horizontal"),frame.feedback.map {it.axis})}
            }
        }
    }
    @Test fun countdownAndPauseExcludeStoppedTimeAndResumeKeepsPhase() {
        val g=guide(config().copy(pacerCountdown=1));val p=MovingPacer();p.command("start",1000,g)
        assertEquals(1000L,p.update(1000,poses(g,0.0),g).countdownMs);assertFalse(p.update(1000,poses(g,0.0),g).valid)
        assertEquals(500L,p.update(1500,emptyList(),g).countdownMs);assertEquals("running",p.update(2000,emptyList(),g).state)
        assertEquals(.125,p.update(2250,emptyList(),g).phase,1e-9);p.command("pause",2300,g)
        val paused=p.update(2600,emptyList(),g);assertEquals("paused",paused.state);assertEquals(.15,paused.phase,1e-9);assertNull(paused.meanError)
        p.command("resume",2700,g);assertEquals(500L,p.update(3200,emptyList(),g).countdownMs)
        assertEquals(.15,p.update(3700,emptyList(),g).phase,1e-9);assertEquals(.25,p.update(3900,emptyList(),g).phase,1e-9)
        p.command("stop",3900,g);val stopped=p.update(3900,emptyList(),g);assertEquals("ready",stopped.state);assertEquals(0.0,stopped.elapsedSeconds,0.0)
        p.command("restart",4000,g);assertEquals(1000L,p.update(4000,emptyList(),g).countdownMs)
    }
    @Test fun repeatedTimesDoNotAddSamplesAndDiscontinuitiesRequireAStart() {
        val g=guide();val p=MovingPacer();p.command("start",0,g);p.update(0,poses(g,0.0),g)
        val missing=p.update(500,emptyList(),g);assertEquals(.25,missing.phase,0.0);assertEquals(50.0,missing.measuredPercent!!,0.0)
        assertEquals(50.0,p.update(500,poses(g,.25),g).measuredPercent!!,0.0)
        assertEquals("ready",p.update(499,emptyList(),g).state);assertNull(p.update(600,emptyList(),g).meanError)
        p.command("start",600,g);assertEquals("ready",p.update(1351,emptyList(),g).state)
        p.command("start",1400,g);assertEquals("running",p.update(1500,emptyList(),g).state)
    }
    @Test fun cosmeticsPreserveRuntimeAndGeometryPacingOrSourceChangesReset() {
        val g=guide();val p=MovingPacer();p.command("start",0,g);p.update(100,emptyList(),g)
        val cosmetic=guide(g.config.copy(pacerDotSize=25.0,trails=false,streakEffects=false,showGuide=false,bpm=140.0))
        p.reconfigure(g.config,cosmetic.config);assertEquals(.1,p.update(200,emptyList(),cosmetic).phase,1e-9)
        for(c in listOf(config().copy(scale=.3),config().copy(pacerRpm=40.0),config().copy(pacerCountdown=2),config().copy(pacerDirection="ccw"),config().copy(tolerance=10.0),config().copy(facing="back"),config().copy(threshold=200),config().copy(staffCount=2))){
            p.command("start",300,g);assertEquals("ready",p.update(400,emptyList(),guide(c)).state)
        }
    }
    @Test fun staticGuideAlignmentOrTwoTipsAtOneDotCannotPassMovingTargets() {
        val g=guide();val p=MovingPacer();p.command("start",0,g);val away=poses(g,.25)
        assertTrue(g.cues(away).all {it.onTarget});assertFalse(p.update(0,away,g).onTarget)
        val same=poses(g,0.0)[0].let {it.copy(b=it.a)};val f=p.update(0,listOf(same),g)
        assertTrue(f.valid);assertFalse(f.onTarget);assertEquals(2,f.feedback.map {it.target}.toSet().size)
    }
    @Test fun unclearOrUnrectifiableEndpointsCannotReceiveCredit() {
        val g=guide(config().copy(staffCount=2));val measured=poses(g,0.0)
        for(bad in listOf(null,measured[0].copy(confidence=.54),measured[0].copy(confidence=Double.NaN),measured[0].copy(blurred=true),measured[0].copy(occluded=true),measured[0].copy(a=P(Double.NaN,0.0)))){
            val p=MovingPacer();p.command("start",0,g);val f=p.update(0,listOf(bad,measured[1]),g)
            assertFalse(f.valid);assertFalse(f.onTarget);assertTrue(f.feedback.isEmpty());assertNull(f.meanError);assertEquals(0.0,f.measuredPercent!!,0.0);assertEquals(2,f.targets.size)
        }
        val calibrated=guide(config().copy(planeCorners=listOf(P(.1,.1),P(.9,.1),P(.9,.9),P(.1,.9)),calibrationImageAspect=4.0/3));val p=MovingPacer();p.command("start",0,calibrated)
        assertFalse(p.update(0,listOf(Segment(P(0.0,0.0),P(10.0,10.0))),calibrated).valid)
    }
    @Test fun fiveSecondHistoryExcludesUnknownTipsAndExpiresDuringMisses() {
        val g=guide();val p=MovingPacer();p.command("start",0,g)
        p.update(0,poses(g,0.0),g);p.update(100,poses(g,.05,2*g.radius*.1),g)
        var frame=p.update(200,emptyList(),g);assertEquals(5.0,frame.meanError!!,1e-8);assertEquals(50.0,frame.onTargetPercent!!,1e-8);assertEquals(200.0/3,frame.measuredPercent!!,1e-8)
        for(t in 300L..5300L step 100)frame=p.update(t,emptyList(),g)
        assertEquals("running",frame.state);assertNull(frame.meanError);assertNull(frame.onTargetPercent);assertEquals(0.0,frame.measuredPercent!!,0.0)
        p.command("pause",5400,g);assertNull(p.update(5400,emptyList(),g).measuredPercent)
        p.command("resume",5500,g);assertEquals(100.0,p.update(5500,poses(g,.7),g).measuredPercent!!,0.0)
    }
    @Test fun sharedNativePacerOracle() {
        val cases=JSONArray()
        for(mode in listOf("circles","antispin"))for(perspective in listOf(false,true)){
            var c=config().copy(mode=mode,staffCount=if(mode=="circles")2 else 1,pacerCountdown=1,pacerDirection=if(perspective)"ccw"else"cw",
                pacerPattern=if(perspective)"same"else"opposite",pacerOffset=90.0,rotation=23.0,
                planeCorners=if(perspective)listOf(P(.12,.1),P(.87,.16),P(.91,.9),P(.08,.81))else emptyList(),calibrationImageAspect=4.0/3)
            val original=c;var g=guide(c);val p=MovingPacer();val steps=JSONArray()
            val plan=listOf(0L to null,100L to "start",600L to null,1100L to null,1350L to null,1450L to null,1600L to "pause",1900L to null,
                2000L to "resume",2500L to null,3000L to null,3250L to null,3250L to null,3300L to "stop",3400L to "restart",3900L to null,
                4400L to null,4500L to null,4600L to "start",5200L to null,5600L to null,5700L to null,6501L to null,6400L to null)
            for((index,event)in plan.withIndex()){
                val (time,operation)=event
                val patch=when(time){1450L->JSONObject().put("pacerDotSize",24).put("trails",false);4500L->JSONObject().put("scale",.35);else->null}
                if(patch!=null){val before=c;c=c.patch(patch);p.reconfigure(before,c);g=guide(c)}
                if(operation!=null)p.command(operation,time,g)
                val staffs:List<Segment?> = poses(g,((time-1100)/2000.0%1+1)%1,if(index%4==0)g.radius*.15 else 0.0).mapIndexed {i,s->
                    if(index%5==2 && i==0)null else if(index%7==3)s.copy(blurred=true)else if(index%3==0)s.reversed()else s
                }
                val step=JSONObject().put("time",time).put("staffs",JSONArray(staffs.map {it?.json() ?: JSONObject.NULL})).put("output",p.update(time,staffs,g).json())
                if(operation!=null)step.put("operation",operation);if(patch!=null)step.put("patch",patch);steps.put(step)
            }
            cases.put(JSONObject().put("config",original.json()).put("width",640).put("height",480).put("steps",steps))
        }
        val file=File("../companion/test/fixtures/native-pacer.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1"){file.parentFile.mkdirs();file.writeText(cases.toString(2)+"\n")}
        assertEquals(BrowserParityTest().canonical(JSONArray(file.readText())),BrowserParityTest().canonical(cases))
    }
}
