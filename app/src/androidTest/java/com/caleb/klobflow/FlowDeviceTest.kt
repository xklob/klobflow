package com.caleb.klobflow

import android.media.MediaMetadataRetriever
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import android.graphics.BitmapFactory
import java.io.DataInputStream
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL

@RunWith(AndroidJUnit4::class)
class FlowDeviceTest {
    private fun await(timeout:Long=15000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if(condition())return;Thread.sleep(150)};assertTrue("Timed out",condition())}
    @Test fun cameraSharingAndZoomRecoverAcrossBackgroundAndRecreation() {
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
        instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.CAMERA").close()
        context.getSharedPreferences("practice",0).edit().putString("config",Config(fps=30,facing="back").json().toString()).putBoolean("sharingEnabled",false).commit()
        ActivityScenario.launch(MainActivity::class.java).use {scenario->
            lateinit var engine:FlowEngine
            scenario.onActivity {engine=it.engine}
            await(25000){engine.ui.value.cameraReady && engine.ui.value.frame?.source=="camera"}
            assertTrue(engine.config.mirror)
            await {kotlin.math.abs(engine.ui.value.zoomMin-engine.ui.value.zoomRatio)<0.01}
            val chosenZoom=kotlin.math.min(engine.ui.value.zoomMax,engine.ui.value.zoomMin*1.4f).toDouble()
            scenario.onActivity {engine.updateConfig(JSONObject().put("zoom",chosenZoom))}
            await {kotlin.math.abs(engine.ui.value.zoomRatio-chosenZoom)<0.05}
            scenario.onActivity {engine.share(true)}
            repeat(3){
                val before=engine.ui.value.frame!!.time
                scenario.moveToState(Lifecycle.State.CREATED)
                assertNull(engine.ui.value.frame);assertFalse(engine.ui.value.cameraReady);assertFalse(engine.ui.value.sharing)
                scenario.moveToState(Lifecycle.State.RESUMED)
                await(25000){engine.ui.value.cameraReady && engine.ui.value.sharing && (engine.ui.value.frame?.time ?: 0)>before}
                assertEquals("back",engine.config.facing)
                assertEquals(chosenZoom,engine.config.zoom,0.001)
                await {kotlin.math.abs(engine.ui.value.zoomRatio-chosenZoom)<0.05}
            }
            scenario.recreate();scenario.onActivity {engine=it.engine}
            await(25000){engine.ui.value.cameraReady && engine.ui.value.sharing && engine.ui.value.frame?.source=="camera"}
            scenario.onActivity {engine.updateConfig(JSONObject().put("facing","front"))}
            await(25000){engine.ui.value.cameraReady && engine.ui.value.frame?.guide?.config?.facing=="front"}
            scenario.moveToState(Lifecycle.State.CREATED);scenario.moveToState(Lifecycle.State.RESUMED)
            await(25000){engine.ui.value.cameraReady && engine.ui.value.frame?.guide?.config?.facing=="front"}
            scenario.onActivity {engine.share(false)}
        }
    }
    @Test fun singleStaffTimingFitAndTutorialAssets() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("practice",0).edit().putString("config",Config(staffCount=1,mode="circles",tempoEnabled=true,autoFit=false).json().toString()).putBoolean("sharingEnabled",false).commit()
        val guides=JSONObject(context.assets.open("practice-guides.json").bufferedReader().use {it.readText()})
        for(mode in listOf("grid","circles","cube","free"))assertEquals(4,guides.getJSONObject(mode).getJSONArray("steps").length())
        ActivityScenario.launch(MainActivity::class.java).use {scenario->
            lateinit var engine:FlowEngine;scenario.onActivity {engine=it.engine;engine.startDemo()}
            await {engine.ui.value.frame?.metrics?.deviation!=null}
            assertNull(engine.ui.value.frame!!.staffs[1]);assertNull(engine.ui.value.frame!!.metrics.symmetry)
            assertTrue(engine.ui.value.frame!!.beat.enabled);assertEquals(1,engine.ui.value.frame!!.beat.targets.size)
            scenario.onActivity {engine.command(JSONObject().put("action","fit").put("sizeOnly",true))}
            // The fit is computed on the analysis thread and applied on main; wait for the fitted frame.
            await(25000){engine.ui.value.frame?.let {it.fitStatus.contains("matches the visible staff length") && kotlin.math.abs(it.guide.config.scale-.22)<.06}==true}
            assertEquals(.22,engine.config.scale,.06)
            scenario.onActivity {engine.command(JSONObject().put("action","syncBeat"))}
            await {engine.ui.value.frame!!.beat.hits.any {it!=null}}
            await(20000){engine.ui.value.frame!!.streak.level==4}
            assertNull("A cancelled camera callback must not report an error in the demo",engine.ui.value.error)
            val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val focus=device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.text("Full screen")),5000)
            assertNotNull("Practice should have a discoverable full-screen action",focus);focus.click()
            assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.text("Exit full screen")),5000))
            val preview=device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.desc("Practice camera preview")),5000)
            assertNotNull(preview)
            val bounds=preview.visibleBounds
            assertTrue("The complete preview must fit on screen",bounds.top>=0 && bounds.bottom<device.displayHeight && bounds.width()>0 && bounds.height()>0)
            Thread.sleep(4500)
            val screenshot=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            java.io.File(context.getExternalFilesDir(null),"practice-streak.png").outputStream().use {screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            screenshot.recycle()
            try{
                device.setOrientationLeft()
                await {device.displayWidth>device.displayHeight}
                val landscape=device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.desc("Practice camera preview")),5000)
                assertNotNull("Landscape focus must retain the preview",landscape)
                assertTrue(landscape.visibleBounds.width()>0 && landscape.visibleBounds.bottom<device.displayHeight)
                val landscapeShot=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                java.io.File(context.getExternalFilesDir(null),"practice-landscape.png").outputStream().use {landscapeShot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
                landscapeShot.recycle()
            }finally{device.setOrientationNatural();device.unfreezeRotation()}
            val beforeExit=engine.ui.value.frame!!.time
            device.findObject(androidx.test.uiautomator.By.text("Exit full screen")).click()
            assertTrue(device.wait(androidx.test.uiautomator.Until.gone(androidx.test.uiautomator.By.text("Exit full screen")),5000))
            await {engine.ui.value.frame!!.time>beforeExit}
            scenario.onActivity {engine.updateConfig(JSONObject().put("streakEffects",false))}
            await {engine.ui.value.frame!!.streak.state=="off"}
            assertEquals(0.0,engine.ui.value.frame!!.streak.seconds,0.0)
        }
    }
    @Test fun liveDetectorSharingControlAndRealCameraRecording() {
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
        instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.CAMERA").close()
        context.getSharedPreferences("practice",0).edit().putString("config",Config().json().toString()).commit()
        context.getSharedPreferences("tutorials",0).edit().apply {for(mode in listOf("grid","circles","cube","free"))putBoolean(mode,true)}.commit()
        ActivityScenario.launch(MainActivity::class.java).use {scenario->
            lateinit var engine:FlowEngine
            scenario.onActivity {engine=it.engine;engine.startDemo();engine.share(true)}
            await {engine.ui.value.frame?.staffs?.count {it!=null && it.confidence>=.55}==2}
            fun request(route:String,origin:Boolean=false,body:String?=null):Pair<Int,String>{
                val socket=java.net.Socket("127.0.0.1",8787);socket.soTimeout=6000
                val payload=body?.toByteArray() ?: byteArrayOf()
                val headers=buildString {
                    append("${if(body==null)"GET" else "POST"} $route HTTP/1.1\r\nHost: 127.0.0.1:8787\r\nConnection: close\r\n")
                    if(origin)append("Origin: https://example.com\r\n")
                    if(body!=null)append("Content-Type: application/json\r\nContent-Length: ${payload.size}\r\n")
                    append("\r\n")
                }
                socket.getOutputStream().apply {write(headers.toByteArray());write(payload);flush()}
                val raw=socket.getInputStream().bufferedReader().use {it.readText()};socket.close()
                return raw.substringBefore("\r\n").split(" ")[1].toInt() to raw.substringAfter("\r\n\r\n")
            }
            assertEquals(403,request("/api/live",true).first)
            val live=JSONObject(request("/api/live").second);assertEquals("demo",live.getString("source"));assertEquals(2,live.getInt("protocol"))
            assertTrue(live.getJSONObject("streak").has("seconds"))
            val connection=URL("http://127.0.0.1:8787/api/stream").openConnection() as HttpURLConnection
            connection.readTimeout=5000
            DataInputStream(connection.inputStream).use {stream->
                var jsonLength=stream.readInt();var imageLength=stream.readInt()
                while(jsonLength==0){assertEquals(0,imageLength);jsonLength=stream.readInt();imageLength=stream.readInt()}
                val metadata=ByteArray(jsonLength);stream.readFully(metadata)
                val image=ByteArray(imageLength);stream.readFully(image)
                assertEquals("demo",JSONObject(String(metadata)).getString("source"))
                assertNotNull(BitmapFactory.decodeByteArray(image,0,image.size))
            };connection.disconnect()
            assertEquals(200,request("/api/control",body="""{"action":"config","config":{"mode":"cube"}}""").first)
            await {engine.ui.value.frame?.guide?.config?.mode=="cube"}
            assertEquals(400,request("/api/control",body="""{"action":"config","config":{"scale":-1}}""").first)
            scenario.onActivity {engine.share(false);engine.updateConfig(JSONObject().put("facing","back").put("fps",30));engine.bindCamera()}
            await(25000){engine.ui.value.cameraReady && engine.ui.value.frame?.source=="camera"}
            val captureTime=engine.ui.value.frame!!.time
            scenario.onActivity {engine.command(JSONObject().put("action","background").put("mode","capture"))}
            await {engine.ui.value.frame?.background?.state=="countdown"}
            await {engine.ui.value.frame!!.time>captureTime+1000}
            assertEquals("countdown",engine.ui.value.frame!!.background.state)
            await(12000){engine.ui.value.frame?.background?.state=="ready"}
            scenario.onActivity {engine.command(JSONObject().put("action","background").put("mode","clear"))}
            await {engine.ui.value.frame?.background?.state=="off"}
            scenario.onActivity {engine.startRecording()}
            await(20000){engine.ui.value.recording && engine.ui.value.elapsed>2500}
            scenario.onActivity {engine.stopRecording()}
            await(20000){!engine.ui.value.finalizing && engine.ui.value.sessions.isNotEmpty()}
            val session=engine.ui.value.sessions.first()
            assertTrue("Recording failed: $session",session.isNull("recordingError"))
            assertTrue(session.getLong("durationMs")>1500)
            assertTrue(engine.sessionFile(session.getString("id")).length()>1000)
            val retriever=MediaMetadataRetriever();retriever.setDataSource(context,android.net.Uri.parse(session.getString("videoUri")))
            assertTrue(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()>1500)
            assertNotNull(retriever.getFrameAtTime(1000000));retriever.release()
            scenario.onActivity {engine.updateConfig(JSONObject().put("mode","grid"));engine.startDemo()}
            await {engine.ui.value.frame?.guide?.cues(engine.ui.value.frame!!.staffs)?.size==4}
            Thread.sleep(600)
            val screenshot=instrumentation.uiAutomation.takeScreenshot()
            java.io.File(context.getExternalFilesDir(null),"practice-demo.png").outputStream().use {screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            screenshot.recycle()
        }
    }
}
