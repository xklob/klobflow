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
                scenario.onActivity {engine.startDemo()}
                val frameDeadline=SystemClock.elapsedRealtime()+10000;while(engine.ui.value.frame?.beat?.enabled!=true&&SystemClock.elapsedRealtime()<frameDeadline)Thread.sleep(100)
                assertTrue(engine.ui.value.frame!!.beat.enabled)
                java.io.File(context.getExternalFilesDir(null),"audio-validation.json").writeText(audio.json().toString(2))
                track.pause();Thread.sleep(2500);assertNull(PhoneAudio.state.value.bpm)
                scenario.onActivity {engine.command(JSONObject().put("action","audioStop"))}
                val stopDeadline=SystemClock.elapsedRealtime()+5000;while(PhoneAudio.state.value.running&&SystemClock.elapsedRealtime()<stopDeadline)Thread.sleep(100);assertFalse(PhoneAudio.state.value.running);assertEquals("manual",engine.config.tempoSource)
                scenario.onActivity {
                    engine.updateConfig(JSONObject().put("tempoSource","pc"))
                    engine.command(JSONObject().put("action","audioTempo").put("running",true).put("bpm",98.0).put("confidence",.95).put("origin",SystemClock.elapsedRealtime().toDouble()).put("ageMs",25))
                }
                Thread.sleep(300);assertEquals(98.0,engine.ui.value.frame!!.beat.bpm,1e-8)
                Thread.sleep(2200);assertFalse("Stale PC audio must pause the beat",engine.ui.value.frame!!.beat.enabled)
                scenario.onActivity {engine.command(JSONObject().put("action","audioStop"))}
            }finally {observing.set(false);observer.join(1000);java.io.File(context.getExternalFilesDir(null),"audio-cadence.json").writeText(org.json.JSONArray(observations.map {it.json()}).toString());track.release();context.stopService(android.content.Intent(context,PlaybackTempoService::class.java))}
        }
    }
}
