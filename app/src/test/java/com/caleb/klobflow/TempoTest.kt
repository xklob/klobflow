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
            repeat(100){state=analyzer.observe(15000+it*20.0,0.0)};assertTrue(state.holding);assertNotNull(state.bpm)
            for(i in 100 until 850)state=analyzer.observe(15000+i*20.0,0.0)
            assertNull(state.bpm);assertFalse(state.holding)
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
        val dropoutStates=JSONArray()
        repeat(901){i->state=analyzer.observe(11020+i*20.0,0.0);if(i in listOf(0,100,350,750,800,900))dropoutStates.put(state.json())}
        assertTrue(dropoutStates.getJSONObject(1).getBoolean("holding"));assertNull(state.bpm)
        val fixture=JSONObject().put("states",states).put("dropoutStates",dropoutStates);val file=File("../companion/test/fixtures/native-tempo.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(fixture.toString(2)+"\n")
        assertEquals(BrowserParityTest().canonical(JSONObject(file.readText())),BrowserParityTest().canonical(fixture))
    }
    @Test fun externalAudioClockAndMissingAudioControlTheBeatFeedback(){
        val g=Guide(Config(staffCount=1,tempoEnabled=true),640,480);val coach=TimingCoach()
        val beat=coach.update(1250,listOf(null,null),g,120.0,1000.0,true)
        assertTrue(beat.enabled);assertEquals(.5,beat.phase,1e-9)
        assertFalse(coach.update(1283,listOf(null,null),g,120.0,1000.0,false).enabled)
    }
    @Test fun inputMeterRetainsPeaksDecaysAndClearsAcrossCaptureGaps(){
        val analyzer=TempoAnalyzer();assertEquals(1.0,analyzer.observe(1000.0,1.0).level,0.0)
        var state=AudioTempo()
        for(i in 1..12)state=analyzer.observe(1000+i*20.0,0.0)
        assertEquals(exp(-240.0/180),state.level,1e-9)
        for(i in 13..80)state=analyzer.observe(1000+i*20.0,0.0)
        assertTrue(state.level<.001);assertNull(state.bpm);assertNull(state.candidateBpm);assertEquals(0.0,state.confidence,0.0);assertEquals(0.0,state.historySeconds,0.0)
        analyzer.observe(2620.0,.8);state=analyzer.observe(4000.0,0.0)
        assertEquals(0.0,state.level,0.0);assertEquals(0.0,state.historySeconds,0.0);assertNull(state.candidateBpm)
    }
    @Test fun diagnosticsSeparateSoundLevelCollectionConfidenceAndLock(){
        val analyzer=TempoAnalyzer();var state=AudioTempo()
        repeat(50){state=analyzer.observe(1000+it*20.0,pulse(it*.02,120.0))}
        assertEquals(.98,state.historySeconds,1e-9);assertEquals(0.0,state.confidence,0.0);assertNull(state.candidateBpm);assertNull(state.bpm)
        for(i in 50 until 700)state=analyzer.observe(1000+i*20.0,pulse(i*.02,120.0))
        assertEquals(8.0,state.historySeconds,0.0);assertEquals(120.0,state.candidateBpm!!,0.0);assertEquals(120.0,state.bpm!!,0.0);assertTrue(state.confidence>=.6)
        val uncertain=TempoAnalyzer()
        repeat(700){state=uncertain.observe(1000+it*20.0,.2*(.6+.3*sin(it*1.314)+.1*cos(it*.137)))}
        assertTrue(state.level>.05);assertTrue(state.candidateBpm!!>=60);assertTrue(state.confidence>0&&state.confidence<.6);assertNull(state.bpm)
        val steady=TempoAnalyzer();repeat(700){state=steady.observe(1000+it*20.0,.2);assertNull("A steady tone must not acquire a beat during startup",state.bpm);assertFalse(state.holding)}
        assertEquals(.2,state.level,0.0);assertEquals(8.0,state.historySeconds,0.0);assertNull(state.bpm);assertNull(state.candidateBpm);assertEquals(0.0,state.confidence,0.0)
    }
    private fun estimate(at:Double,bpm:Double?=120.0)=AudioTempo(running=true,bpm=bpm,origin=1000.0,confidence=if(bpm==null).2 else .9,level=.1,at=at,historySeconds=5.0,candidateBpm=bpm)
    private fun qualifiedHold():TempoHold=TempoHold().also {hold->for(t in 1000..4000 step 20)hold.update(estimate(t.toDouble()))}
    @Test fun holdRequiresStableSecondsPreservesPhaseAndExpiresAtDeadline(){
        val brief=TempoHold();for(t in 1000 until 4000 step 20)brief.update(estimate(t.toDouble()))
        assertFalse(brief.update(estimate(4000.0,null)).holding)
        val hold=qualifiedHold();val kept=hold.update(estimate(4020.0,null).copy(level=0.0,historySeconds=0.0))
        assertTrue(kept.holding);assertEquals(120.0,kept.bpm!!,0.0);assertEquals(1000.0,kept.origin,0.0);assertEquals(.9,kept.confidence,0.0)
        assertEquals(0.0,kept.level,0.0);assertEquals(0.0,kept.historySeconds,0.0);assertEquals(14980.0,kept.holdRemainingMs,0.0)
        val last=hold.update(estimate(18999.0,null));assertEquals(1.0,last.holdRemainingMs,0.0);assertTrue(last.usable(18999.0));assertFalse(last.usable(19000.0))
        val expired=hold.update(estimate(19000.0,null));assertNull(expired.bpm);assertFalse(expired.holding)
    }
    @Test fun briefConfidenceReturnsCannotRenewHoldButThreeStableSecondsCan(){
        val hold=qualifiedHold();hold.update(estimate(4020.0,null));hold.update(estimate(10000.0))
        assertEquals(8980.0,hold.update(estimate(10020.0,null)).holdRemainingMs,0.0)
        for(t in 11000..14000 step 20)hold.update(estimate(t.toDouble()))
        assertEquals(14980.0,hold.update(estimate(14020.0,null)).holdRemainingMs,0.0)
    }
    @Test fun stopClockReversalDifferentTempoAndSparseSamplesCannotPreserveHold(){
        val stopped=qualifiedHold();stopped.update(estimate(4020.0,null).copy(running=false));assertFalse(stopped.update(estimate(4040.0,null)).holding)
        val reversed=qualifiedHold();assertFalse(reversed.update(estimate(2000.0,null)).holding)
        val changed=qualifiedHold();assertEquals(150.0,changed.update(estimate(4020.0,150.0)).bpm!!,0.0);assertFalse(changed.update(estimate(4040.0,null)).holding)
        val gaps=TempoHold();for(t in 1000..5000 step 200)gaps.update(estimate(t.toDouble()));assertFalse(gaps.update(estimate(5020.0,null)).holding)
    }
}
