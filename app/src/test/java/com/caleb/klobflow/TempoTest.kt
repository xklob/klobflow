package com.caleb.klobflow
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import kotlin.math.*
class TempoTest {
    private fun pulse(t:Double,bpm:Double)=.3*exp(-(t%(60/bpm))/.045)
    @Test fun hardwareTimestampJitterCannotReverseSampleTimeOrBreakTempo(){
        val clock=AudioSampleClock();val analyzer=TempoAnalyzer();var previous=0.0;var state=AudioTempo()
        repeat(700){i->val time=clock.endTime((i+1)*960L,1000+(i+1)*20.0,1000+sin(i*2.3)*80)
            if(i>0)assertTrue(time-previous in 19.89..20.11)
            state=analyzer.observe(time,pulse((i+1)*.02,120.0));previous=time}
        assertEquals(120.0,state.bpm!!,2.0)
    }
    @Test fun periodicAudioLocksAndSilenceClearsTempo(){
        for(bpm in listOf(60.0,90.0,120.0,174.0,200.0)){
            val analyzer=TempoAnalyzer();var state=AudioTempo()
            repeat(700){val t=it*.02;state=analyzer.observe(1000+t*1000,pulse(t,bpm))}
            assertNotNull("Tempo $bpm not found: $state",state.bpm);assertEquals(bpm,state.bpm!!,2.0);assertTrue(state.confidence>=.6)
            assertFalse(state.usable(state.at+2500))
            repeat(100){state=analyzer.observe(15000+it*20.0,0.0)};assertNull(state.bpm)
        }
    }
    @Test fun adaptsToTempoChangesWithoutTreatingSilenceAsAPulse(){
        val analyzer=TempoAnalyzer();var state=AudioTempo()
        repeat(700){state=analyzer.observe(1000+it*20.0,pulse(it*.02,90.0))}
        repeat(700){state=analyzer.observe(15000+it*20.0,pulse(it*.02,150.0))}
        assertEquals(150.0,state.bpm!!,2.0)
        val silent=TempoAnalyzer();repeat(700){assertNull(silent.observe(1000+it*20.0,0.0).bpm)}
    }
    @Test fun pcmEnergyAndNativeBrowserTempoOracle(){
        val envelope=AudioEnvelope();val analyzer=TempoAnalyzer();val states=JSONArray();var state=AudioTempo()
        for(i in 0 until 48000*10){val t=i/48000.0;val phase=t%.5;val pcm=.65*sin(2*PI*70*t)*exp(-phase/.035);val energy=envelope.sample(pcm)
            if(energy!=null){state=analyzer.observe(1000+(i+1)*1000.0/48000,energy);if((i+1)%12000==0)states.put(state.json())}}
        assertEquals(120.0,state.bpm!!,2.0)
        val fixture=JSONObject().put("states",states);val file=File("../companion/test/fixtures/native-tempo.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(fixture.toString(2)+"\n")
        assertEquals(BrowserParityTest().canonical(JSONObject(file.readText())),BrowserParityTest().canonical(fixture))
    }
    @Test fun externalAudioClockAndMissingAudioControlTheBeatFeedback(){
        val g=Guide(Config(staffCount=1,tempoEnabled=true),640,480);val coach=TimingCoach()
        val beat=coach.update(1250,listOf(null,null),g,120.0,1000.0,true)
        assertTrue(beat.enabled);assertEquals(.5,beat.phase,1e-9)
        assertFalse(coach.update(1283,listOf(null,null),g,120.0,1000.0,false).enabled)
    }
}
