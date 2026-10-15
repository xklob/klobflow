package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class ScoreValidityTest {
    @Test fun uncertainEndsCannotContributeCoverageOrSpeedDespiteHighConfidence(){
        for(blurred in listOf(true,false)){
            val g=Guide(Config(staffCount=1,mode="circles"),640,480);val scorer=Scorer()
            fun sample(time:Long,uncertain:Boolean):Segment {
                val angle=time/1000.0
                return Segment(g.point(cos(angle),sin(angle)),g.point(-cos(angle),-sin(angle)),confidence=1.0,blurred=uncertain&&blurred,occluded=uncertain&&!blurred)
            }
            for(time in 0L..1000L step 20){
                val score=scorer.score(time,listOf(sample(time,true),null),g)
                assertEquals(0.0,score.coverage,0.0);assertNull(score.deviation);assertNull(score.steadiness)
            }
            val recovered=scorer.score(1020,listOf(sample(1020,false),null),g)
            assertEquals(100.0/52,recovered.coverage,1e-9);assertNull(recovered.steadiness)
            var score=Metrics()
            for(time in 1040L..2300L step 20)score=scorer.score(time,listOf(sample(time,false),null),g)
            assertEquals(100.0,score.coverage,0.0);assertNotNull(score.steadiness)
        }
    }
}
