package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class DetectionFiltersTest {
    private val w=160;private val h=120
    private fun scene(staff:Boolean=true):IntArray {
        val p=IntArray(w*h){0xff101010.toInt()}
        for(y in 8 until 112)for(x in 130 until 134)p[y*w+x]=0xfff8f8f8.toInt()
        if(staff)for(x in 24 until 94)for(y in 57 until 62)p[y*w+x]=if(y==59)0xffffffff.toInt()else 0xffff20dd.toInt()
        return p
    }
    @Test fun selectedColorRejectsSunlightAndRetainsWhiteLedCores(){
        val p=scene();val filtered=filterStaffColors(p,w,h,listOf("pink"))
        assertEquals(p[59*w+40],filtered[59*w+40]);assertEquals(0,filtered[20*w+131])
        val found=StaffDetector().detect(p,w,h,Config(staffCount=1,staffColors=listOf("pink")))
        assertEquals(1,found.size);assertTrue(found[0].center.x<.8);assertTrue(found[0].confidence>=.55)
        val colors=longArrayOf(0xffff0000,0xffff8800,0xffffff00,0xff00ff00,0xff00ffff,0xff0044ff,0xff8800ff,0xffff00dd,0xffffffff).map {it.toInt()}
        colors.forEachIndexed {i,color->assertEquals(color,filterStaffColors(intArrayOf(color),1,1,listOf(staffColorNames[i]))[0])}
        assertArrayEquals(intArrayOf(colors[0],colors[5],0),filterStaffColors(intArrayOf(colors[0],colors[5],colors[3]),3,1,listOf("red","blue")))
        assertEquals(listOf("red","blue"),Config().patch(JSONObject("""{"staffColors":["red","blue","red"]}""")).staffColors)
        try{Config().patch(JSONObject("""{"staffColors":["ultraviolet"]}"""));fail("Invalid color accepted")}catch(_:IllegalArgumentException){}
    }
    @Test fun largeWhiteCapsKeepTheirInteriorWhenSurroundedBySelectedGlow(){
        val p=IntArray(w*h){0xff101010.toInt()}
        for(cx in listOf(38,104))for(y in 0 until h)for(x in 0 until w){
            val d=(x-cx)*(x-cx)+(y-60)*(y-60)
            if(d<=12*12)p[y*w+x]=if(d<=10*10)0xffffffff.toInt()else 0xffff20dd.toInt()
        }
        val actual=filterStaffColors(p,w,h,listOf("pink"))
        for(cx in listOf(38,104))for(y in 51..69)for(x in cx-9..cx+9)
            if((x-cx)*(x-cx)+(y-60)*(y-60)<=9*9)assertEquals("White cap interior at $x,$y",p[y*w+x],actual[y*w+x])
    }
    @Test fun localColorCannotFloodFillAnUnrelatedWhiteLight(){
        val p=scene(false)
        // A small reflection touches a long white slit, but does not surround it.
        for(y in 55..59)for(x in 127..129)p[y*w+x]=0xffff20dd.toInt()
        val actual=filterStaffColors(p,w,h,listOf("pink"))
        assertEquals(0,actual[20*w+131]);assertEquals(0,actual[100*w+131])
        assertEquals(0,filterStaffColors(IntArray(w*h){0xffffffff.toInt()},w,h,listOf("pink"))[60*w+80])
    }
    @Test fun selectedCapsRecoverAWhiteShaftJoinedToSunlightWithoutAdmittingSunlight(){
        val width=384;val height=216;val pixels=IntArray(width*height){0xff101010.toInt()}
        fun rect(x0:Int,y0:Int,x1:Int,y1:Int,color:Long){for(y in y0..y1)for(x in x0..x1)pixels[y*width+x]=color.toInt()}
        for((lo,hi) in listOf(70 to 150,164 to 245)){rect(lo,104,hi,110,0xffff20dd);rect(lo,106,hi,108,0xffffffff)}
        // Flooding this neutral component would admit sunlight to the image edge.
        rect(70,100,110,112,0xffc8c8c8);rect(70,106,150,108,0xffffffff)
        rect(70,104,73,105,0xffff20dd);rect(70,109,73,110,0xffff20dd);rect(90,0,92,104,0xffc8c8c8)
        val c=Config(staffCount=1,threshold=250,staffColors=listOf("pink","purple"))
        val masked=filterStaffColors(pixels,width,height,c.staffColors)
        assertEquals(0,masked[107*width+90]);assertEquals(0,masked[10*width+91])
        for(rotate in listOf(false,true))for(threshold in listOf(175,250)){
            val ww=if(rotate)height else width;val hh=if(rotate)width else height
            val frame=if(rotate)IntArray(pixels.size)else pixels
            if(rotate)for(y in 0 until height)for(x in 0 until width)frame[x*ww+height-1-y]=pixels[y*width+x]
            val found=StaffDetector().detect(frame,ww,hh,c.copy(threshold=threshold));assertEquals(1,found.size)
            val positions=listOf(found[0].a,found[0].b).map {(if(rotate)it.y else it.x)*216}.sorted()
            assertEquals(70.0,positions[0],1.0);assertEquals(245.0,positions[1],1.0)
            assertEquals(.7,found[0].confidence,0.0);assertFalse(found[0].blurred);assertFalse(found[0].occluded)
        }
        // White geometry cannot replace the missing selected-color cap evidence.
        rect(70,104,73,105,0xffc8c8c8);rect(70,109,73,110,0xffc8c8c8)
        val unsupported=StaffDetector().detect(pixels,width,height,c);assertEquals(1,unsupported.size)
        assertTrue(minOf(unsupported[0].a.x,unsupported[0].b.x)*216>100)
        // A valid nearby staff does not turn a one-sided reflection on a
        // collinear white background line into an observed far cap.
        rect(70,104,72,105,0xffff20dd)
        val reflection=StaffDetector().detect(pixels,width,height,c);assertEquals(1,reflection.size)
        assertTrue(minOf(reflection[0].a.x,reflection[0].b.x)*216>100)
    }
    @Test fun rawRecoveryCannotPromoteAWhiteSlitWithSmallColoredReflections(){
        val width=384;val height=216;val c=Config(staffCount=1,threshold=250,staffColors=listOf("pink","purple"))
        for(reflections in listOf(emptyList(),listOf(104),listOf(5,200))){
            val p=IntArray(width*height){0xff101010.toInt()}
            for(y in 5..205)for(x in 310..315)p[y*width+x]=0xffffffff.toInt()
            for(top in reflections)for(y in top..top+5)for(x in 306..309)p[y*width+x]=0xffff20dd.toInt()
            assertTrue(StaffDetector().detect(p,width,height,c).isEmpty())
        }
    }
    @Test fun supportedClippedCapConflictStaysUnscoredWithoutFalseMotionBlur(){
        val width=384;val height=216;val pixels=IntArray(width*height){0xff101010.toInt()}
        fun rect(x0:Int,y0:Int,x1:Int,y1:Int,color:Long){for(y in y0..y1)for(x in x0..x1)pixels[y*width+x]=color.toInt()}
        for((lo,hi) in listOf(3 to 83,97 to 178)){rect(lo,104,hi,110,0xffff20dd);rect(lo,106,hi,108,0xffffffff)}
        rect(3,100,43,112,0xffc8c8c8);rect(3,106,83,108,0xffffffff)
        rect(3,104,6,105,0xffff20dd);rect(3,109,6,110,0xffff20dd);rect(23,0,25,104,0xffc8c8c8)
        for(threshold in listOf(175,250)){
            val c=Config(staffCount=1,threshold=threshold,staffColors=listOf("pink","purple"))
            val found=StaffDetector().detect(pixels,width,height,c);assertEquals(1,found.size)
            assertEquals(.5,found[0].confidence,0.0);assertFalse(found[0].blurred);assertFalse(found[0].occluded)
            assertTrue("Retain original geometry, not the clipped raw end",minOf(found[0].a.x,found[0].b.x)*216>30)
            val tracker=StaffTracker();val scorer=Scorer();val guide=Guide(c,width,height)
            for(time in listOf(1000L,1017L,1034L))tracker.update(listOf(found[0].copy(confidence=.8)),time,1)
            for(time in 1051L..1153L step 17){
                val staffs=tracker.update(found,time,1);val s=staffs[0];val metrics=scorer.score(time,staffs,guide)
                assertNotNull(s);assertTrue(s!!.confidence<=.5);assertFalse(s.blurred);assertFalse(s.occluded);assertTrue(guide.cues(staffs).isEmpty())
                assertNull(metrics.deviation);assertNull(metrics.angle);assertNull(metrics.steadiness);assertEquals(0.0,metrics.coverage,0.0)
            }
        }
    }
    @Test fun colorRecoveryNeedsTwoInteriorHueSupportedCapsAndCannotReuseARawStaff(){
        val c=Config(staffCount=2,threshold=250,staffColors=listOf("pink"))
        val s=Segment(P(60.0/h,60.0/h),P(120.0/h,60.0/h),.8);val raw=s.copy(a=P(40.0/h,60.0/h))
        val p=IntArray(w*h)
        fun cap(x:Int,color:Long,cy:Int=60){for(y in cy-1..cy+1)for(xx in x-1..x+1)p[y*w+xx]=color.toInt()}
        cap(40,0xffff20dd);cap(120,0xffffffff)
        assertEquals(listOf(s),recoverSelectedColorEndpoints(p,w,h,c,listOf(s)){listOf(raw)})
        cap(120,0xffff20dd)
        for(candidate in listOf(raw.copy(blurred=true),raw.copy(occluded=true),raw.copy(confidence=.7)))
            assertEquals(listOf(s),recoverSelectedColorEndpoints(p,w,h,c,listOf(s)){listOf(candidate)})
        assertEquals(listOf(raw.copy(confidence=.7),s),recoverSelectedColorEndpoints(p,w,h,c,listOf(s,s.copy())){listOf(raw)})
        p.fill(0);cap(30,0xffff20dd);cap(120,0xffff20dd)
        assertEquals(listOf(s),recoverSelectedColorEndpoints(p,w,h,c,listOf(s)){listOf(raw.copy(a=P(30.0/h,.5)))})
        p.fill(0);cap(40,0xffff20dd);cap(120,0xffff20dd)
        var calls=0;val rawCheck={calls++;listOf(raw)}
        for(candidate in listOf(s.copy(blurred=true),s.copy(occluded=true),s.copy(confidence=.7)))
            assertEquals(listOf(candidate),recoverSelectedColorEndpoints(p,w,h,c,listOf(candidate),rawCheck))
        for(colors in listOf(emptyList(),listOf("white"),listOf("pink","white")))
            recoverSelectedColorEndpoints(p,w,h,c.copy(staffColors=colors),listOf(s),rawCheck)
        assertEquals(0,calls)
        p.fill(0);cap(3,0xffff20dd);cap(80,0xffff20dd)
        val edgeSelected=s.copy(a=P(20.0/h,.5),b=P(80.0/h,.5));val edgeRaw=edgeSelected.copy(a=P(3.0/h,.5))
        assertEquals(listOf(edgeSelected.copy(confidence=.5)),recoverSelectedColorEndpoints(p,w,h,c,listOf(edgeSelected)){listOf(edgeRaw)})
        for(vertical in listOf(false,true))for(inset in listOf(4,5)){
            val end=(if(vertical)h else w)-inset;val start=if(vertical)40 else 80
            fun point(n:Int)=if(vertical)P(.5,n.toDouble()/h)else P(n.toDouble()/h,.5)
            val selected=s.copy(a=point(start),b=point(start+60));val candidate=s.copy(a=point(start),b=point(end))
            p.fill(0);cap(if(vertical)60 else start,0xffff20dd,if(vertical)start else 60)
            cap(if(vertical)60 else end,0xffff20dd,if(vertical)end else 60)
            val actual=recoverSelectedColorEndpoints(p,w,h,c,listOf(selected)){listOf(candidate)}[0]
            assertEquals((if(inset==4)start+60 else end).toDouble()/h,if(vertical)actual.b.y else actual.b.x,0.0)
            assertEquals(if(inset==4).5 else .7,actual.confidence,0.0);assertFalse(actual.blurred)
        }
    }
    @Test fun backgroundRemovesStaticLightsWithoutLearningAwayHeldStaves(){
        val bg=BackgroundFilter();val empty=scene(false);bg.begin(1000)
        assertTrue(bg.apply(empty,w,h,5999,"camera").all {it==0});assertEquals(1L,bg.status.remainingMs)
        for(t in listOf(6000L,6100L,6200L,6400L))bg.apply(empty,w,h,t,"camera")
        assertEquals("ready",bg.status.state);assertTrue(bg.apply(empty,w,h,6500,"camera").all {it==0})
        val dimmed=empty.map {if(it==0xfff8f8f8.toInt())0xffbfbfbf.toInt()else it}.toIntArray()
        assertTrue(bg.apply(dimmed,w,h,6550,"camera").all {it==0})
        for(t in listOf(6600L,10000L,30000L)){
            val found=StaffDetector().detect(bg.apply(scene(),w,h,t,"camera"),w,h,Config(staffCount=1))
            assertEquals(1,found.size);assertTrue(found[0].center.x<.8)
        }
        assertSame(empty,bg.apply(empty,w,h,31000,"zoom2"));assertEquals("off",bg.status.state)
        bg.begin(32000);bg.clear();assertEquals("off",bg.status.state);assertSame(empty,bg.apply(empty,w,h,40000,"camera"))
    }
}
