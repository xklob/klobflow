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
