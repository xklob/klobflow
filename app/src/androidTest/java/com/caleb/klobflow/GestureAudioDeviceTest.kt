package com.caleb.klobflow

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class GestureAudioDeviceTest {
    private fun await(timeout:Long=7000,test:()->Boolean){val until=SystemClock.elapsedRealtime()+timeout;while(!test()){if(SystemClock.elapsedRealtime()>until)fail("Timed out");Thread.sleep(40)}}
    @Test fun handsFreeAlignmentAndAudioDotsUseNativeFramesAndVisibleControls(){
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
        context.getSharedPreferences("practice",0).edit().putString("config",Config(mode="circles",staffCount=1,pacerEnabled=true,pacerCountdown=0).json().toString()).putBoolean("sharingEnabled",false).commit()
        context.getSharedPreferences("tutorials",0).edit().putBoolean("circles",true).commit()
        ActivityScenario.launch(MainActivity::class.java).use {scenario->
            lateinit var engine:FlowEngine;scenario.onActivity {engine=it.engine;engine.startDemo()}
            await {engine.ui.value.frame!=null}
            val timer=FlowEngine::class.java.getDeclaredField("demoTimer").apply {isAccessible=true}.get(engine) as java.util.concurrent.ScheduledExecutorService
            timer.shutdownNow();assertTrue(timer.awaitTermination(5,TimeUnit.SECONDS));scenario.onActivity {engine.resetTracking()}
            val generation=FlowEngine::class.java.getDeclaredField("generation").apply {isAccessible=true}.getInt(engine)
            val process=FlowEngine::class.java.getDeclaredMethod("process",Bitmap::class.java,java.lang.Long.TYPE,String::class.java,java.lang.Integer.TYPE).apply {isAccessible=true}
            val device=UiDevice.getInstance(instrumentation)
            device.findObject(By.text("Full screen")).click()
            assertTrue(device.wait(Until.hasObject(By.text("Exit full screen")),3000))
            val failure=AtomicReference<Throwable?>(null);val start=SystemClock.elapsedRealtime();val source=Executors.newSingleThreadScheduledExecutor()
            source.scheduleAtFixedRate({try{
                val now=SystemClock.elapsedRealtime();val elapsed=now-start
                val bitmap=Bitmap.createBitmap(640,480,Bitmap.Config.ARGB_8888);val canvas=Canvas(bitmap);canvas.drawColor(Color.rgb(8,8,8))
                val pen=Paint().apply {color=Color.WHITE;strokeWidth=7f;strokeCap=Paint.Cap.ROUND}
                if(elapsed in 1200..6900){canvas.drawLine(.48f*480,.25f*480,.86f*480,.75f*480,pen);canvas.drawLine(.48f*480,.75f*480,.86f*480,.25f*480,pen)}
                else canvas.drawLine(.5f*480,.7f*480,.9f*480,.7f*480,pen)
                process.invoke(engine,bitmap,now,"camera",generation)
            }catch(t:Throwable){failure.set(t)}},0,50,TimeUnit.MILLISECONDS)
            try {
                await(11000){failure.get()!=null || engine.ui.value.frame?.gesture?.state=="countdown"};failure.get()?.let {throw it}
                val during=engine.ui.value.frame!!;assertNull(during.metrics.deviation);assertFalse(during.pacer.valid);assertEquals(0,during.json().getJSONArray("feedback").length())
                assertTrue(device.wait(Until.hasObject(By.textContains("AUTO-ALIGNMENT IN")),2000))
                val screenshot=instrumentation.uiAutomation.takeScreenshot()
                val capture=java.io.File(context.getExternalFilesDir(null),"gesture-countdown.png")
                capture.outputStream().use {assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG,100,it))};screenshot.recycle();assertTrue(capture.length()>1000)
                await(12000){failure.get()!=null || engine.ui.value.frame?.gesture?.state=="success"};failure.get()?.let {throw it}
                assertEquals(.525,engine.ui.value.config.cx,.025);assertEquals(.7,engine.ui.value.config.cy,.025);assertEquals(.2,engine.ui.value.config.scale,.025);assertEquals(1,engine.ui.value.config.staffCount)
                // A real transport audio payload must drive the same pacing that is drawn/exported.
                scenario.onActivity {
                    engine.updateConfig(JSONObject().put("tempoEnabled",true).put("tempoSource","pc"))
                    engine.command(JSONObject().put("action","pacer").put("operation","start"))
                }
                await {engine.ui.value.frame?.pacer?.state=="waitingAudio"}
                assertTrue(device.wait(Until.hasObject(By.text("WAITING FOR MUSIC BEAT")),2000))
                val initial=SystemClock.elapsedRealtime()
                for(i in 0..15){
                    scenario.onActivity {engine.command(JSONObject().put("action","audioTempo").put("running",true).put("bpm",120).put("confidence",.9).put("origin",initial).put("ageMs",0))}
                    Thread.sleep(50)
                }
                await {engine.ui.value.frame?.pacer?.state=="running"}
                assertEquals(30.0,engine.ui.value.frame!!.pacer.rpm,0.0);assertTrue(engine.ui.value.frame!!.pacer.audioSynced)
                val phase=engine.ui.value.frame!!.pacer.phase;Thread.sleep(150);assertTrue(kotlin.math.abs(phase-engine.ui.value.frame!!.pacer.phase)>.01)
                await {engine.ui.value.frame?.pacer?.state=="waitingAudio"}
                assertFalse(engine.ui.value.frame!!.pacer.valid);assertEquals(0.0,engine.ui.value.frame!!.streak.seconds,0.0)
            }finally {source.shutdownNow();assertTrue(source.awaitTermination(5,TimeUnit.SECONDS))}
        }
    }
}
