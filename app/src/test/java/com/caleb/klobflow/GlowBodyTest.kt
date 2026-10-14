package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.*

class GlowBodyTest {
    private fun image(theta:Double,red:Boolean=false,cx:Double=2.0/3,bulbs:Boolean=false)=IntArray(320*240){i->
        val dx=(i%320)/240.0-cx;val dy=(i/320)/240.0-.5
        val a=dx*cos(theta)+dy*sin(theta);val b=-dx*sin(theta)+dy*cos(theta)
        when {
            abs(a)<.04||abs(a)>.34||abs(b)>.055||bulbs&&abs(a)<.28->0xff101510.toInt()
            abs(a)<=.31&&abs(b)<=.010->if(red)0xffff0000.toInt()else 0xfffff0f0.toInt()
            else->if(red)0xffaf0000.toInt()else 0xffdc2882.toInt()
        }
    }
    @Test fun visibleShaftCapsRecoverPrecisionInsideColoredGlow(){
        for(red in listOf(false,true)) {
            val detector=StaffDetector();val tracker=StaffTracker();val c=Config(staffCount=1)
            repeat(12){i->val theta=.2+i*.12;val time=1000L+i*17
                val s=tracker.update(detector.detect(image(theta,red),320,240,c,tracker.hints(time,1)),time,1)[0]
                assertNotNull(s);s!!;assertFalse(s.occluded);assertFalse(s.blurred)
                assertTrue(angleDifference(s.angle,theta)<.025);assertTrue(s.center.distance(P(2.0/3,.5))<.01)
                assertEquals(.62,s.length,.012)
                if(i>=2)assertNotNull(Scorer().score(time,listOf(s),Guide(c,320,240)).deviation)
            }
        }
    }
    @Test fun clippedGlowAndIsolatedBulbsCannotSupplyRecoveredPrecision(){
        for(pixels in listOf(image(0.0,cx=.13),image(0.0,bulbs=true)))
            assertTrue(StaffDetector().detect(pixels,320,240,Config(staffCount=1)).all {it.blurred||it.confidence<.55})
    }
    @Test fun detachedBrightReflectionsCannotExtendARecoveredShaftCap(){
        val pixels=image(0.0);for(y in 118..121)for(x in 70..73)pixels[y*320+x]=0xffffffff.toInt()
        val s=StaffDetector().detect(pixels,320,240,Config(staffCount=1)).first()
        assertFalse(s.blurred);assertEquals(2.0/3-.31,min(s.a.x,s.b.x),.012);assertEquals(.62,s.length,.012)
    }
    @Test fun exportsNativeGlowEndpointOracle(){
        val fixture=JSONArray()
        for(red in listOf(false,true))repeat(12){i->val angle=.2+i*.12
            val staffs=StaffDetector().detect(image(angle,red),320,240,Config(staffCount=1))
            fixture.put(JSONObject().put("angle",angle).put("red",red).put("staffs",JSONArray(staffs.map {it.json()})))
        }
        val file=File("../companion/test/fixtures/native-glow.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(fixture.toString(2)+"\n")
        assertEquals(BrowserParityTest().canonical(JSONArray(file.readText())),BrowserParityTest().canonical(fixture))
    }
}
