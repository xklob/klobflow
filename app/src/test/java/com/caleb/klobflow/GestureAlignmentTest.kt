package com.caleb.klobflow

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import kotlin.math.*

class GestureAlignmentTest {
    private val x=listOf(Segment(P(.48,.25),P(.86,.75)),Segment(P(.48,.75),P(.86,.25)))
    private fun pose(cx:Double=.7,cy:Double=.7,len:Double=.4)=Segment(P(cx-len/2,cy),P(cx+len/2,cy))
    private fun guide(c:Config=Config(staffCount=1))=Guide(c,640,480)
    private fun hold(a:GestureAlignment,g:Guide){for(t in 0L..5000L step 125)assertNull(a.update(t,x,emptyList(),g));assertEquals("countdown",a.state);assertEquals(5000,a.frame.remainingMs)}
    private fun countdown(a:GestureAlignment,g:Guide,staffs:List<Segment?>){for(t in 5125L..10000L step 125)assertNull(a.update(t,null,staffs,g));assertEquals("settling",a.state)}
    private fun settle(a:GestureAlignment,g:Guide,staffs:List<Segment?>,zoom:Boolean=false):GestureAction? {var action:GestureAction?=null;for(t in 10125L..12000L step 125)action=a.update(t,null,staffs,g,if(zoom).5 else 1.0,if(zoom)4.0 else 1.0,1.0) ?: action;return action}
    @Test fun crossingRequiresTwoSteadyDiagonalsForFiveSeconds(){
        assertNull(findCross(listOf(x[0]),640,480));assertNull(findCross(listOf(pose(),pose(.7,.4)),640,480))
        assertNull(findCross(listOf(pose(.7,.5),Segment(P(.7,.2),P(.7,.8))),640,480))
        assertNull(findCross(x.map {it.copy(blurred=true)},640,480));assertEquals(2,findCross(x,640,480)!!.size)
        val a=GestureAlignment();val g=guide()
        for(t in 0L until 5000L step 125)a.update(t,x,emptyList(),g)
        assertEquals("holding",a.state);a.update(5000,emptyList(),emptyList(),g);assertEquals("idle",a.state)
        for(t in 5125L until 10125L step 125)a.update(t,x,emptyList(),g)
        assertEquals("holding",a.state);a.update(10125,x,emptyList(),g);assertEquals("countdown",a.state)
        val moving=GestureAlignment()
        for(t in 0L..10000L step 125){val d=P(.06*sin(t/400.0),0.0);moving.update(t,x.map {it.copy(a=it.a+d,b=it.b+d)},emptyList(),g)}
        assertNotEquals("countdown",moving.state)
    }
    @Test fun allModesFitGripCentersAndModeSizeAfterBothIntervals(){
        for(mode in listOf("grid","circles","cube","free","antispin"))for(count in 1..2){
            val g=guide(Config(mode=mode,staffCount=count));val a=GestureAlignment();hold(a,g)
            val staffs=if(count==1)listOf(pose())else listOf(pose(.55),pose(.8));countdown(a,g,staffs)
            val action=settle(a,g,staffs)!!;assertEquals("applying",a.state)
            assertEquals((if(count==1).7 else .675)/(4.0/3),action.config.getDouble("cx"),1e-8);assertEquals(.7,action.config.getDouble("cy"),1e-8)
            val scale=when(mode){"antispin"->.4;"cube"->1.0/6;else->.2};assertEquals(scale,action.config.getDouble("scale"),1e-8)
            if(count==2 && mode in listOf("circles","antispin"))assertEquals(.25/scale,action.config.getDouble("circleSeparation"),1e-8)
            assertEquals(count,action.seeds!!.size);a.accept(12000);assertEquals("success",a.state);assertFalse(a.frame.active)
        }
    }
    @Test fun movingOrHiddenPoseNeverCompletesAndEndpointReversalIsSafe(){
        val g=guide();val a=GestureAlignment();hold(a,g);countdown(a,g,emptyList())
        for(t in 10125L..14000L step 125)assertNull(a.update(t,null,listOf(pose(.7+.08*sin(t/500.0))),g))
        for(t in 14125L..17000L step 125)assertNull(a.update(t,null,listOf(pose().copy(occluded=true)),g))
        var action:GestureAction?=null
        for(t in 17125L..19125L step 125)action=a.update(t,null,listOf(if(t%250==0L)pose()else pose().reversed()),g) ?: action
        assertNotNull(action);assertEquals(.7,action!!.config.getDouble("cy"),1e-8)
    }
    @Test fun cancelGapsAndSuspensionInvalidateOldTriggersAndPendingChanges(){
        val g=guide();val a=GestureAlignment();hold(a,g);a.cancel(5000)
        for(t in 5125L..13000L step 125)assertNull(a.update(t,x,listOf(pose()),g));assertEquals("idle",a.state)
        for(t in 13125L..14250L step 125)a.update(t,emptyList(),listOf(pose()),g)
        for(t in 14375L..19375L step 125)a.update(t,x,listOf(pose()),g)
        assertEquals("countdown",a.state);a.update(21000,null,listOf(pose()),g);assertEquals("cancelled",a.state)
        a.accept(21100);assertEquals("cancelled",a.state);a.suspend(true,21200)
        for(t in 21200L..28000L step 125)a.update(t,x,listOf(pose()),g);assertEquals("idle",a.state)
        val gap=GestureAlignment();for(t in 0L..4875L step 125)gap.update(t,x,emptyList(),g)
        gap.update(5200,x,emptyList(),g);assertEquals("holding",gap.state);assertEquals(5000,gap.frame.remainingMs)
        val off=GestureAlignment();hold(off,g);off.update(5125,null,listOf(pose()),guide(g.config.copy(gestureEnabled=false)));assertEquals("idle",off.state)
    }
    @Test fun zoomNeedsAcknowledgementSettlingAndFreshPostZoomSamples(){
        var g=guide(Config(mode="circles",staffCount=1));val a=GestureAlignment();hold(a,g);countdown(a,g,listOf(pose(2.0/3,.5,.3)))
        val zoom=settle(a,g,listOf(pose(2.0/3,.5,.3)),true)!!;assertEquals(1.5,zoom.config.getDouble("zoom"),1e-8)
        for(t in 12125L..12500L step 125)assertNull(a.update(t,null,listOf(pose()),g,.5,4.0,1.0))
        a.accept(12500);g=guide(g.config.patch(zoom.config))
        for(t in 12625L until 13100L step 125)assertNull(a.update(t,null,listOf(pose(2.0/3,.5,.45)),g,.5,4.0,1.5))
        var action:GestureAction?=null
        for(t in 13125L..15125L step 125)action=a.update(t,null,listOf(pose(2.0/3,.5,.45)),g,.5,4.0,1.5) ?: action
        assertNotNull(action);assertEquals(.225,action!!.config.getDouble("scale"),1e-8);assertFalse(action!!.config.has("zoom"))
    }
    @Test fun perspectiveKeepsZoomAndRotatedTwoStaffFitKeepsRotationAndIdentity(){
        val g=guide(Config(mode="circles",staffCount=1,planeCorners=listOf(P(.05,.05),P(.95,.1),P(.93,.95),P(.03,.9)),calibrationImageAspect=4.0/3));val a=GestureAlignment();hold(a,g)
        val s=pose(.5,.6,.3);val projected=s.copy(a=g.project(s.a),b=g.project(s.b));countdown(a,g,listOf(projected))
        val action=settle(a,g,listOf(projected),true)!!;assertFalse(action.config.has("zoom"));assertEquals(.5,action.config.getDouble("cx"),1e-8);assertEquals(.6,action.config.getDouble("cy"),1e-8)
        val rotated=guide(Config(mode="antispin",staffCount=2,rotation=30.0));val b=GestureAlignment();hold(b,rotated)
        val origin=P(.7,.6);val dx=P(cos(PI/6)*.1,sin(PI/6)*.1);val staffs=listOf(origin+dx,origin-dx).map {pose(it.x,it.y)};countdown(b,rotated,staffs)
        val fit=settle(b,rotated,staffs)!!;assertFalse(fit.config.has("rotation"));val fitted=guide(rotated.config.patch(fit.config))
        fitted.circles.forEachIndexed {i,p->assertEquals(0.0,p.distance(fit.seeds!![i].center),1e-8)}
    }
    @Test fun realWhiteAndRainbowCrossImagesTriggerWithoutPracticeTracker(){
        val w=192;val h=144
        for(colors in listOf(listOf(0xffffffff.toInt(),0xffffffff.toInt()),listOf(0xffff0033.toInt(),0xff00ccff.toInt()))){
            val pixels=IntArray(w*h){i->val p=P((i%w)/h.toDouble(),(i/w)/h.toDouble());val n=x.indexOfFirst {distanceToSegment(p,it)<.012};if(n<0)0xff080808.toInt()else colors[n]}
            val scanner=CrossScanner();val a=GestureAlignment();val g=guide()
            assertEquals(2,findCross(scanner.scan(pixels,w,h,0,g.config)!!,w,h)!!.size);assertNull(scanner.scan(pixels,w,h,124,g.config))
            for(t in 0L..5000L step 125)a.update(t,scanner.scan(pixels,w,h,t+250,g.config),emptyList(),g)
            assertEquals("countdown",a.state)
        }
        assertNull(findCross(CrossScanner().scan(IntArray(w*h),w,h,0,Config())!!,w,h))
    }
    @Test fun sharedGestureOracleCoversEveryModeOneAndTwoStaves(){
        val cases=JSONArray()
        for(mode in listOf("grid","circles","cube","free","antispin"))for(count in 1..2){
            val g=guide(Config(mode=mode,staffCount=count));val a=GestureAlignment();val staffs=if(count==1)listOf(pose())else listOf(pose(.55),pose(.8));val frames=JSONArray();var last=""
            for(t in 0L..12000L step 125){
                val action=a.update(t,if(t<=5000)x else null,staffs,g)
                if(t%1000==0L || a.state!=last || action!=null)frames.put(JSONObject().put("time",t).put("status",a.frame.json()).put("patch",action?.config ?: JSONObject.NULL))
                last=a.state
            }
            cases.put(JSONObject().put("config",g.config.json()).put("frames",frames))
        }
        val file=File("../companion/test/fixtures/native-gesture.json")
        if(System.getenv("KLOBFLOW_UPDATE_FIXTURES")=="1")file.writeText(cases.toString(2)+"\n")
        assertEquals(BrowserParityTest().canonical(JSONArray(file.readText())),BrowserParityTest().canonical(cases))
    }
}
