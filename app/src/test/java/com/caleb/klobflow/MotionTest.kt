package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.*

class MotionTest {
    private val w=320;private val h=240
    private fun render(angle:Double,sweep:Double,gap:Double=.08,rainbow:Boolean=true):IntArray {
        val samples=if(sweep>0)17 else 1
        val centers=listOf(P(.36,.5),P(.99,.5));val directions=listOf(1,-1);val length=.55
        val poses=centers.mapIndexed {n,center->List(samples){i->val a=angle*directions[n]+if(samples==1)0.0 else sweep*(i.toDouble()/(samples-1)-.5);Triple(center,cos(a),sin(a))}}
        return IntArray(w*h){i->val x=i%w;val y=i/w;val background=intArrayOf(16,21,16);val rgb=background.copyOf()
            poses.forEachIndexed {n,staff->val energy=DoubleArray(3)
                staff.forEachIndexed {j,p->val dx=x.toDouble()/h-p.first.x;val dy=y.toDouble()/h-p.first.y;val along=dx*p.second+dy*p.third;val across=-dx*p.third+dy*p.second
                    if(abs(along)<=length/2 && abs(along)>=gap/2 && abs(across)<=.012){
                        val color=if(rainbow)IntArray(3){c->(135+110*sin(along/length*PI*4+angle*3+j*.07+c*PI*2/3)).roundToInt()}else if(n==0)intArrayOf(182,243,107)else intArrayOf(181,163,255)
                        for(c in 0..2)energy[c]+=color[c]-background[c]
                    }
                }
                for(c in 0..2)rgb[c]+=(energy[c]/samples).roundToInt()
            }
            (255 shl 24) or (rgb[0].coerceAtMost(255) shl 16) or (rgb[1].coerceAtMost(255) shl 8) or rgb[2].coerceAtMost(255)
        }
    }
    @Test fun spinningRainbowAndDarkGripsRemainObservedButBroadBlurDoesNotScore(){
        val detector=StaffDetector();val tracker=StaffTracker();val fixture=JSONArray()
        repeat(24){i->val time=1000L+i*33;val theta=if(i<4).8 else .8+(i-4)*.3;val sweep=if(i<4)0.0 else .4
            val candidates=detector.detect(render(theta,sweep),w,h,Config(),tracker.hints(time))
            val staffs=tracker.update(candidates,time)
            if(i>=4)staffs.forEachIndexed {n,s->
                assertNotNull("Lost staff $n at frame $i",s);s!!;assertFalse(s.occluded);assertTrue(s.blurred);assertTrue(s.confidence<.55)
                assertTrue(angleDifference(s.angle,theta*(if(n==0)1 else -1))<.08);assertEquals(.55,s.length,.06)
                assertNull(Scorer().score(time,staffs,Guide(Config(),w,h)).deviation)
            }
            val frame=JSONObject().put("angle",theta).put("sweep",sweep).put("gap",.08).put("rainbow",true).put("length",.55).put("centers",JSONArray(listOf(listOf(.36,.5),listOf(.99,.5)))).put("directions",JSONArray(listOf(1,-1)))
            fixture.put(JSONObject().put("time",time).put("frame",frame).put("staffs",JSONArray(staffs.map {it?.json()?:JSONObject.NULL})))
        }
        val file=File("../companion/test/fixtures/native-motion.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(fixture.toString(2)+"\n")
        assertEquals(BrowserParityTest().canonical(JSONArray(file.readText())),BrowserParityTest().canonical(fixture))
        assertTrue(tracker.update(emptyList(),4000).all {it==null})
    }
    @Test fun fastRotationMaintainsTheObservedEndpoint(){
        val tracker=StaffTracker()
        repeat(25){i->val theta=if(i<4)0.0 else (i-3)*.72;val d=P(cos(theta),sin(theta))*.3;val center=P(.66,.5);val s=Segment(center-d,center+d)
            val actual=tracker.update(listOf(s),1000L+i*33,1)[0]!!
            assertFalse(actual.occluded);assertEquals(0.0,actual.a.distance(s.a),1e-8)
        }
    }
    @Test fun brightAreasCannotBecomeMotionMeasurements(){
        val hints=listOf(Segment(P(.35,.5),P(.97,.5)));val detector=StaffDetector()
        for(fill in listOf(0xffffffff.toInt(),0xff103010.toInt()))assertTrue(detector.detect(IntArray(w*h){fill},w,h,Config(),hints).isEmpty())
    }
}
