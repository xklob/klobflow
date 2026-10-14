package com.caleb.klobflow
import org.junit.Assert.*
import org.junit.Test
class FeedbackTest {
    @Test fun allGreenTipsDoNotReferToMissingOrangeArrowsWhileSettling(){
        val guide=Guide(Config(staffCount=1),320,240);val s=Segment(guide.point(-1.0,-1.0),guide.point(-1.0,1.0));val coach=AlignmentFeedback()
        coach.update(0,listOf(s,null),guide);val confirming=coach.update(650,listOf(s,null),guide)
        assertFalse(confirming.title.contains("OFF GUIDE"));assertFalse(confirming.title.contains("MOVE ORANGE"))
        val settling=coach.update(1000,listOf(s,null),guide)
        assertTrue(settling.tips.all {it.onTarget});assertFalse(settling.title.contains("OFF GUIDE"));assertFalse(settling.title.contains("MOVE ORANGE"))
        assertFalse(Regex("amber|orange|white TARGET|along.*arrow",RegexOption.IGNORE_CASE).containsMatchIn(settling.detail))
    }
    @Test fun clearObservationsResumeImmediatelyWhileTextStaysReadable(){
        val guide=Guide(Config(staffCount=1),320,240);val s=Segment(guide.point(-1.0,-1.0),guide.point(-1.0,1.0));val coach=AlignmentFeedback()
        val text=StableText<String>();var previous="";var changes=0
        repeat(200){i->val blurred=i%5==0;val v=coach.update(i*33L,listOf(s.copy(blurred=blurred),null),guide)
            assertEquals(!blurred,v.trackingConfirmed);assertEquals(blurred,v.state=="paused")
            assertEquals(if(blurred)0 else 2,v.tips.size);assertNotEquals("aligned",v.state)
            val shown=text.update(i*33L,v.state){a,b->b=="paused"&&a!="paused"}
            if(shown!=previous){changes++;previous=shown}
        }
        assertTrue("Text must not alternate at camera frame rate",changes<8)
        repeat(100){i->coach.update((200+i)*33L,listOf(s,null),guide)}
        assertEquals("aligned",coach.update(10000,listOf(s,null),guide).state)
        assertEquals("paused",coach.update(10033,listOf(s.copy(blurred=true),null),guide).state)
    }
}
