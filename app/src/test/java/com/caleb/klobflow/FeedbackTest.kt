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
    @Test fun intermittentBlurCannotFlashValidAlignment(){
        val guide=Guide(Config(staffCount=1),320,240);val s=Segment(guide.point(-1.0,-1.0),guide.point(-1.0,1.0));val coach=AlignmentFeedback()
        repeat(200){i->assertEquals("paused",coach.update(i*33L,listOf(s.copy(blurred=i%5==0),null),guide).state)}
        repeat(100){i->coach.update((200+i)*33L,listOf(s,null),guide)}
        assertEquals("aligned",coach.update(10000,listOf(s,null),guide).state)
        assertEquals("paused",coach.update(10033,listOf(s.copy(blurred=true),null),guide).state)
    }
}
