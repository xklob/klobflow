package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.*

class AudioPacerTest {
    private fun guide(mode:String="circles",count:Int=1)=Guide(Config(mode=mode,staffCount=count,pacerEnabled=true,pacerCountdown=0,tempoEnabled=true,tempoSource="pc"),640,480)
    private fun audio(t:Long,bpm:Double=120.0)=AudioTempo(running=true,bpm=bpm,origin=floor(t/(60000/bpm))*(60000/bpm),confidence=.9,at=t.toDouble())
    @Test fun fourBeatsMakeOneCycleForEachModeAndCountWithoutOriginJumps(){
        for(mode in listOf("circles","antispin"))for(count in listOf(1,2))for(rate in listOf(.5,1.0,2.0)){
            val g=Guide(guide(mode,count).config.copy(audioRate=rate),640,480);val p=MovingPacer();p.command("start",0,g)
            for(t in 0L..2500L step 50){
                val f=p.update(t,emptyList(),g,audio(t));assertEquals("running",f.state);assertEquals(30.0*rate,f.rpm,0.0)
                assertEquals((t*rate/2000.0)%1,f.phase,1e-8);assertEquals(count,f.targets.size)
                if((t*rate)%500==0.0 && mode=="antispin"){
                    val pair=f.targets.first().map {g.antispinLocal(it,0)}
                    assertEquals(g.radius,max(abs(pair[0].x),abs(pair[1].y)),1e-8)
                }
            }
        }
    }
    @Test fun qualifiedHoldContinuesForFifteenSecondsThenFreezesWithoutScores(){
        val g=guide();val p=MovingPacer();val hold=TempoHold();p.command("start",0,g)
        var last=PacerFrame();var stoppedPhase:Double?=null
        for(t in 0L..19500L step 20){
            val a=hold.update(if(t<=3500)audio(t)else audio(t).copy(bpm=null,confidence=0.0))
            last=p.update(t,emptyList(),g,a)
            if(t<18500){assertEquals("running",last.state);assertEquals((t/2000.0)%1,last.phase,1e-8)}
            else {assertEquals("waitingAudio",last.state);assertFalse(last.valid);assertNull(last.meanError);if(stoppedPhase==null)stoppedPhase=last.phase;assertEquals(stoppedPhase!!,last.phase,0.0)}
        }
        p.command("pause",19500,g);assertEquals("paused",p.update(19600,emptyList(),g,audio(19600)).state)
        p.command("resume",19600,g);val resumed=p.update(19600,emptyList(),g,audio(19600));assertEquals("running",resumed.state);assertEquals(last.phase,resumed.phase,0.0)
        assertEquals("ready",p.update(20400,emptyList(),g,audio(20400)).state)
    }
    @Test fun audioRateOffsetAndPhaseCorrectionsAreBounded(){
        val g=Guide(guide().config.copy(audioRate=2.0,audioOffsetMs=125.0),640,480);val p=MovingPacer();p.command("start",0,g)
        var last=p.update(0,emptyList(),g,audio(0));assertEquals(.375,last.phase,1e-8);assertEquals(60.0,last.rpm,0.0)
        for(t in 25L..500L step 25){last=p.update(t,emptyList(),g,audio(t));assertEquals((.375+t/1000.0)%1,last.phase,1e-8)}
        val changed=p.update(525,emptyList(),g,audio(525).copy(origin=200.0));val delta=(changed.phase-last.phase+1)%1
        assertTrue(delta in .021249.. .028751)
        assertEquals("waitingAudio",p.update(550,emptyList(),g,audio(550).copy(at=-2000.0)).state)
    }
    @Test fun nativeAudioPacerOracle(){
        val cases=JSONArray()
        for(mode in listOf("circles","antispin"))for(count in listOf(1,2)){
            val g=guide(mode,count);val p=MovingPacer();val steps=JSONArray()
            for(t in 0L..6000L step 100){
                val op=when(t){0L->"start";4000L->"pause";4500L->"resume";5500L->"stop";else->null}
                if(op!=null)p.command(op,t,g)
                val a=audio(t,if(t>=3000)100.0 else 120.0).let {if(t in 2000..2500)it.copy(bpm=null,confidence=0.0)else if(t in 1000..1500)it.copy(holding=true,holdRemainingMs=5000.0)else it}
                val f=p.update(t,emptyList(),g,a)
                val staffs=f.targets.map {Segment(it[0],it[1],.9)}
                val step=JSONObject().put("time",t).put("audio",a.json()).put("staffs",JSONArray(staffs.map {it.json()})).put("output",p.update(t,staffs,g,a).json())
                if(op!=null)step.put("operation",op);steps.put(step)
            }
            cases.put(JSONObject().put("config",g.config.json()).put("steps",steps))
        }
        val file=File("../companion/test/fixtures/native-audio-pacer.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(cases.toString(2)+"\n")
        assertEquals(BrowserParityTest().canonical(JSONArray(file.readText())),BrowserParityTest().canonical(cases))
    }
}
