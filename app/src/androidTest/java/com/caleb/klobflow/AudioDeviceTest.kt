package com.caleb.klobflow
import android.Manifest
import android.media.*
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.*

@RunWith(AndroidJUnit4::class)
class AudioDeviceTest {
    private fun await(message:String,timeout:Long=10000,condition:()->Boolean){
        val deadline=SystemClock.elapsedRealtime()+timeout
        while(!condition() && SystemClock.elapsedRealtime()<deadline)Thread.sleep(25)
        assertTrue(message,condition())
    }
    private fun assertCleared(audio:AudioTempo){
        assertNull(audio.bpm);assertNull(audio.candidateBpm)
        assertEquals(0.0,audio.confidence,0.0);assertEquals(0.0,audio.level,0.0);assertEquals(0.0,audio.historySeconds,0.0)
        assertFalse(audio.holding);assertEquals(0.0,audio.holdRemainingMs,0.0)
    }
    private fun screenshot(name:String){
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val bitmap=instrumentation.uiAutomation.takeScreenshot()
        java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"audio-$name.png").outputStream().use {bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        bitmap.recycle()
    }
    @Test fun approvedPlaybackCaptureDetectsRealAudioAndStops(){
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext;val device=UiDevice.getInstance(instrumentation)
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName,Manifest.permission.RECORD_AUDIO)
        context.getSharedPreferences("practice",0).edit().putString("config",Config(tempoEnabled=true,staffCount=1,autoFit=false).json().toString()).putBoolean("sharingEnabled",false).commit()
        ActivityScenario.launch(MainActivity::class.java).use {scenario->
            lateinit var engine:FlowEngine;scenario.onActivity {engine=it.engine;it.requestSystemAudio()}
            val consent=device.wait(Until.findObject(By.res("android:id/button1")),8000)
            assertNotNull("Android must ask for audio sharing consent",consent);consent.click()
            val start=SystemClock.elapsedRealtime();while(!PhoneAudio.state.value.running&&SystemClock.elapsedRealtime()-start<10000)Thread.sleep(100)
            assertTrue("Capture did not start: ${PhoneAudio.state.value}",PhoneAudio.state.value.running)
            val rate=48000;val samples=ShortArray(rate*4){i->val t=i.toDouble()/rate;(.65*sin(2*PI*70*t)*exp(-(t%.5)/.035)*32767).toInt().toShort()}
            val track=AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_ALL).build()).setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()).setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.size*2).build()
            val observations=java.util.Collections.synchronizedList(mutableListOf<AudioTempo>())
            val observing=java.util.concurrent.atomic.AtomicBoolean(true)
            val observer=kotlin.concurrent.thread(isDaemon=true){while(observing.get()){observations.add(PhoneAudio.state.value);Thread.sleep(10)}}
            try {
                assertEquals(samples.size,track.write(samples,0,samples.size));track.setLoopPoints(0,samples.size,-1);track.play()
                val deadline=SystemClock.elapsedRealtime()+25000
                while((PhoneAudio.state.value.bpm==null || abs(PhoneAudio.state.value.bpm!!-120)>2) && SystemClock.elapsedRealtime()<deadline)Thread.sleep(200)
                val audio=PhoneAudio.state.value;assertNotNull("Real playback did not lock: $audio",audio.bpm);assertEquals(120.0,audio.bpm!!,2.0);assertTrue(audio.confidence>=.6)
                assertNotNull("Locked playback must report its candidate tempo",audio.candidateBpm)
                assertEquals(120.0,audio.candidateBpm!!,2.0)
                assertTrue("Lock must include measured audio history: $audio",audio.historySeconds in 2.4..8.0)
                val captured=synchronized(observations){observations.toList()}
                assertTrue("Real captured sound must move the incoming-level meter",captured.any {it.level>.005})
                assertTrue("Audio history must advance before a tempo estimate exists",captured.any {it.historySeconds>0 && it.historySeconds<2.4 && it.candidateBpm==null})
                assertTrue("Capture diagnostics must remain finite and bounded",captured.all {it.level.isFinite() && it.level in 0.0..1.0 && it.historySeconds.isFinite() && it.historySeconds in 0.0..8.0})
                val json=audio.json()
                assertEquals(audio.historySeconds,json.getDouble("historySeconds"),0.0)
                assertEquals(audio.candidateBpm!!,json.getDouble("candidateBpm"),0.0)
                scenario.onActivity {engine.startDemo()}
                val frameDeadline=SystemClock.elapsedRealtime()+10000;while(engine.ui.value.frame?.beat?.enabled!=true&&SystemClock.elapsedRealtime()<frameDeadline)Thread.sleep(100)
                assertTrue(engine.ui.value.frame!!.beat.enabled)
                device.wait(Until.findObject(By.text("Adjust")),5000).click()
                assertTrue("Adjust page should finish opening",device.wait(Until.hasObject(By.text("Make the space yours.")),5000))
                // Compose updates its scroll bounds after a page change. Use visible content
                // and bounded gestures rather than UiScrollable's cached legacy hierarchy.
                var swipes=0
                while(!device.hasObject(By.text("Beat locked")) && swipes++<12){
                    device.swipe(device.displayWidth/2,device.displayHeight*4/5,device.displayWidth/2,device.displayHeight/3,100)
                    device.wait(Until.hasObject(By.text("Beat locked")),300)
                }
                assertTrue("Native audio panel should be discoverable",device.hasObject(By.text("Beat confidence")))
                assertTrue(device.wait(Until.hasObject(By.text("Incoming sound")),5000))
                assertTrue(device.wait(Until.hasObject(By.text("Beat locked")),5000))
                screenshot("phone-locked")
                java.io.File(context.getExternalFilesDir(null),"audio-validation.json").writeText(audio.json().toString(2))
                var stableSince:Double?=null
                await("Real playback must stay qualified for three seconds before a music break",15000){
                    val current=PhoneAudio.state.value
                    if(current.bpm!=null && abs(current.bpm!!-120)<=2 && current.confidence>=.6 && !current.holding){
                        if(stableSince==null)stableSince=current.at
                        current.at-stableSince!!>=3200
                    }else {stableSince=null;false}
                }
                track.pause()
                await("A qualified tempo must survive a quiet music break",5000){PhoneAudio.state.value.let {it.holding && it.level<.001 && it.historySeconds==0.0 && it.candidateBpm==null}}
                val held=PhoneAudio.state.value
                assertTrue(held.running);assertEquals(120.0,held.bpm!!,2.0);assertTrue(held.confidence>=.6)
                assertTrue("Hold must expose a bounded positive countdown",held.holdRemainingMs>0 && held.holdRemainingMs<=15000)
                assertTrue(held.json().getBoolean("holding"));assertEquals(held.holdRemainingMs,held.json().getDouble("holdRemainingMs"),0.0)
                await("Held tempo must continue timing on current silent observations",1500){engine.ui.value.frame?.let {it.audio.holding && it.beat.enabled}==true}
                assertTrue(device.wait(Until.hasObject(By.textContains("Holding tempo")),5000))
                assertTrue(device.wait(Until.hasObject(By.text("Last beat confidence")),5000))
                assertTrue(device.wait(Until.hasObject(By.text("Quiet")),5000))
                screenshot("phone-holding")
                await("Hold countdown must decrease while phase and tempo stay fixed",5000){PhoneAudio.state.value.let {it.holding && it.at>=held.at+1200 && it.holdRemainingMs<held.holdRemainingMs-800}}
                val laterHeld=PhoneAudio.state.value
                assertEquals(held.origin,laterHeld.origin,0.0);assertEquals(held.bpm!!,laterHeld.bpm!!,0.0);assertEquals(held.confidence,laterHeld.confidence,0.0)
                await("The music-break hold must expire and clear tempo diagnostics",23000){PhoneAudio.state.value.let {!it.holding && it.holdRemainingMs==0.0 && it.bpm==null && it.candidateBpm==null && it.historySeconds==0.0 && it.confidence==0.0 && it.level<.001}}
                assertTrue("Capture remains active during silence",PhoneAudio.state.value.running)
                assertTrue(device.wait(Until.hasObject(By.text("Quiet")),5000))
                assertTrue(device.wait(Until.hasObject(By.text("0%")),5000))
                screenshot("phone-quiet")
                scenario.onActivity {engine.command(JSONObject().put("action","audioStop"))}
                val stopDeadline=SystemClock.elapsedRealtime()+5000;while(PhoneAudio.state.value.running&&SystemClock.elapsedRealtime()<stopDeadline)Thread.sleep(100);assertFalse(PhoneAudio.state.value.running);assertEquals("manual",engine.config.tempoSource)
                assertCleared(PhoneAudio.state.value)
                scenario.onActivity {
                    engine.updateConfig(JSONObject().put("tempoSource","pc"))
                    engine.command(JSONObject().put("action","audioTempo").put("running",true).put("bpm",JSONObject.NULL).put("confidence",.42).put("origin",0.0).put("ageMs",25).put("level",.25).put("historySeconds",3.2).put("candidateBpm",98.0))
                }
                await("Unlocked PC telemetry must reach a new frame",1500){engine.ui.value.frame?.let {it.guide.config.tempoSource=="pc" && it.audio.historySeconds==3.2 && it.audio.candidateBpm==98.0}==true}
                val pending=engine.ui.value.frame!!
                assertFalse("A candidate must not enable beat timing",pending.beat.enabled)
                assertNull(pending.audio.bpm);assertEquals(.25,pending.audio.level,0.0);assertEquals(.42,pending.audio.confidence,0.0)
                assertEquals(3.2,pending.audio.json().getDouble("historySeconds"),0.0)
                assertEquals(98.0,pending.audio.json().getDouble("candidateBpm"),0.0)
                scenario.onActivity {
                    engine.command(JSONObject().put("action","audioTempo").put("running",true).put("bpm",98.0).put("confidence",.95).put("origin",SystemClock.elapsedRealtime().toDouble()).put("ageMs",25).put("level",.4).put("historySeconds",8.0).put("candidateBpm",98.0))
                }
                // Wait for a frame produced with the new clock, not an arbitrary rendering delay.
                val pcDeadline=SystemClock.elapsedRealtime()+1500
                while(engine.ui.value.frame?.let {it.guide.config.tempoSource=="pc" && it.beat.enabled && abs(it.beat.bpm-98.0)<1e-8}!=true && SystemClock.elapsedRealtime()<pcDeadline)Thread.sleep(25)
                assertEquals("pc",engine.ui.value.frame!!.guide.config.tempoSource)
                assertTrue("Fresh PC tempo must enable timing",engine.ui.value.frame!!.beat.enabled)
                assertEquals(98.0,engine.ui.value.frame!!.beat.bpm,1e-8)
                assertEquals(.4,engine.ui.value.frame!!.audio.level,0.0)
                assertEquals(8.0,engine.ui.value.frame!!.audio.historySeconds,0.0)
                assertEquals(98.0,engine.ui.value.frame!!.audio.candidateBpm!!,0.0)
                val pcOrigin=engine.ui.value.frame!!.audio.origin
                scenario.onActivity {
                    engine.command(JSONObject().put("action","audioTempo").put("running",true).put("bpm",98.0).put("confidence",.95).put("origin",pcOrigin).put("ageMs",25).put("level",0.0).put("historySeconds",0.0).put("candidateBpm",JSONObject.NULL).put("holding",true).put("holdRemainingMs",12000.0))
                }
                await("Held PC telemetry must preserve its qualified tempo",1500){engine.ui.value.frame?.let {it.audio.holding && it.audio.holdRemainingMs==12000.0 && it.beat.enabled}==true}
                assertEquals(pcOrigin,engine.ui.value.frame!!.audio.origin,0.0)
                assertTrue(engine.ui.value.frame!!.audio.json().getBoolean("holding"))
                // Assert against a newly processed frame, not an old UI snapshot on a busy emulator.
                val staleAfter=SystemClock.elapsedRealtime()+2200
                val staleDeadline=staleAfter+10000
                while(engine.ui.value.frame!!.time<staleAfter && SystemClock.elapsedRealtime()<staleDeadline)Thread.sleep(50)
                assertTrue("No fresh frame arrived for the stale-audio check",engine.ui.value.frame!!.time>=staleAfter)
                assertFalse("Stale PC audio must pause the beat",engine.ui.value.frame!!.beat.enabled)
                assertTrue(device.wait(Until.hasObject(By.text("No signal")),5000))
                assertTrue(device.wait(Until.hasObject(By.text("0%")),5000))
                screenshot("pc-stale")
                scenario.onActivity {
                    // A fresh packet near the end of a hold legitimately retains an old phase origin.
                    engine.command(JSONObject().put("action","audioTempo").put("running",true).put("bpm",98.0).put("confidence",.95).put("origin",SystemClock.elapsedRealtime().toDouble()-14000).put("holding",true).put("holdRemainingMs",1000.0))
                }
                await("A fresh PC hold must accept its fourteen-second-old phase before manual stop",1500){engine.ui.value.frame?.let {it.audio.holding && it.audio.holdRemainingMs==1000.0 && it.beat.enabled}==true}
                scenario.onActivity {engine.command(JSONObject().put("action","audioStop"))}
                await("Stopping audio must clear frame telemetry"){engine.ui.value.frame?.let {it.guide.config.tempoSource=="manual" && !it.audio.running && it.audio.historySeconds==0.0}==true}
                assertCleared(engine.ui.value.frame!!.audio)
                assertTrue(device.wait(Until.hasObject(By.text("Off")),5000))
                screenshot("manual-stopped")
                scenario.onActivity {
                    engine.updateConfig(JSONObject().put("tempoSource","pc"))
                    // Older companions omit the optional diagnostic fields.
                    engine.command(JSONObject().put("action","audioTempo").put("running",true).put("bpm",98.0).put("confidence",.95).put("origin",SystemClock.elapsedRealtime().toDouble()))
                }
                await("Legacy PC packets must remain usable without stale diagnostics",1500){engine.ui.value.frame?.let {it.guide.config.tempoSource=="pc" && it.beat.enabled && it.audio.level==0.0 && it.audio.historySeconds==0.0 && it.audio.candidateBpm==null && !it.audio.holding && it.audio.holdRemainingMs==0.0}==true}
                scenario.onActivity {engine.command(JSONObject().put("action","audioStop"))}
            }finally {observing.set(false);observer.join(1000);java.io.File(context.getExternalFilesDir(null),"audio-cadence.json").writeText(org.json.JSONArray(observations.map {it.json()}).toString());track.release();context.stopService(android.content.Intent(context,PlaybackTempoService::class.java))}
        }
    }
}
