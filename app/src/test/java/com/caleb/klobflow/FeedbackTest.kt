package com.caleb.klobflow
import org.junit.Assert.*
import org.junit.Test
class FeedbackTest {
    @Test fun briefBehindTheBackOcclusionKeepsRecentSummaryWithoutHiddenTipCredit(){
        val g=Guide(Config(mode="circles",staffCount=1),320,240)
        val s=Segment(g.center-P(g.radius,0.0),g.center+P(g.radius,0.0));val coach=AlignmentFeedback()
        repeat(60){coach.update(it*17L,listOf(s),g)}
        val hidden=s.copy(occluded=true,confidence=.3);val v=coach.update(2200,listOf(hidden),g)
        assertFalse(v.trackingConfirmed);assertTrue(v.tips.isEmpty());assertEquals("100% ON TARGET",v.summary!!.title)
        assertTrue(v.tracking.title.endsWith("% MEASURED"));assertNull(coach.update(2600,listOf(hidden),g).summary)
    }
    @Test fun recentCircleFeedbackSeparatesAlignmentFromTrackingCoverage(){
        val c=Config(mode="circles",staffCount=1,tolerance=15.0);val g=Guide(c,320,240)
        val s=Segment(g.center-P(g.radius,0.0),g.center+P(g.radius,0.0));val coach=AlignmentFeedback()
        var v=Coaching("","","")
        repeat(200){i->v=coach.update(i*25L,listOf(s.copy(blurred=i%5==4)),g)}
        assertFalse(v.trackingConfirmed);assertEquals("paused",v.state);assertTrue(v.tips.isEmpty())
        assertEquals("100% ON TARGET",v.summary!!.title);assertEquals("80% MEASURED",v.tracking.title)
        assertTrue(v.summary!!.detail.contains("excluded"))
        v=coach.update(6100,listOf(s.copy(blurred=true)),g)
        assertNull(v.summary);assertEquals("ENDS UNCLEAR",v.tracking.title)
        assertNull(coach.update(6200,listOf(s),Guide(c.copy(tolerance=30.0),320,240)).summary)
    }
    @Test fun expandedToleranceChangesAlignmentWithoutApprovingBlurredTips(){
        val c=Config(mode="circles",staffCount=1).patch(org.json.JSONObject().put("tolerance",50))
        val g=Guide(c,320,240);val s=Segment(g.center-P(g.radius*1.6,0.0),g.center+P(g.radius*1.6,0.0))
        assertTrue(g.cues(listOf(s)).all {it.onTarget})
        assertTrue(Guide(c.copy(tolerance=15.0),320,240).cues(listOf(s)).all {!it.onTarget})
        assertFalse(AlignmentFeedback().update(0,listOf(s.copy(blurred=true)),g).trackingConfirmed)
        try{c.patch(org.json.JSONObject().put("tolerance",50.5));fail("Invalid tolerance accepted")}catch(_:IllegalArgumentException){}
    }
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
