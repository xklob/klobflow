package com.caleb.klobflow

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class RollingErrorsTest {
    @Test fun oldErrorsExpireAndUncertaintyIsNeverDisplayedAsAValidAverage(){
        val average=RollingErrors();val c=Config()
        average.update(0,Metrics(0.0,10.0,4.0),c)
        average.update(1000,Metrics(10.0,20.0),c)
        assertEquals(10.0,average.update(4000,Metrics(20.0,30.0,8.0),c).deviation!!,0.0)
        val later=average.update(5001,Metrics(30.0,40.0,10.0,steadiness=7.0,coverage=80.0),c)
        assertEquals(20.0,later.deviation!!,0.0);assertEquals(30.0,later.angle!!,0.0);assertEquals(9.0,later.symmetry!!,0.0)
        assertEquals(7.0,later.steadiness!!,0.0);assertEquals(80.0,later.coverage,0.0)
        val missing=average.update(5050,Metrics(),c);assertNull(missing.deviation);assertNull(missing.angle);assertNull(missing.symmetry)
        assertEquals(30.0,average.update(6001,Metrics(40.0),c).deviation!!,0.0)
    }
    @Test fun layoutChangesAndBackwardReplayStartFreshAverages(){
        val average=RollingErrors();val c=Config();average.update(100,Metrics(50.0),c)
        assertEquals(2.0,average.update(200,Metrics(2.0),c.copy(scale=.4)).deviation!!,0.0)
        assertEquals(1.0,average.update(0,Metrics(1.0),c.copy(scale=.4)).deviation!!,0.0)
    }
    @Test fun legacyStartupFitIsDisabledWithoutDiscardingSavedFraming(){
        val saved=Config(autoFit=true,cx=.36,cy=.57,scale=.27,rotation=12.0,zoom=2.0)
        val restored=Config().patch(JSONObject(saved.json().toString()),restore=true)
        assertFalse(restored.autoFit);assertEquals(saved.copy(autoFit=false),restored)
    }
}
