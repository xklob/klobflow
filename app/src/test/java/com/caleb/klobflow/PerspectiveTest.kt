package com.caleb.klobflow

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PerspectiveTest {
    private val corners=listOf(P(.18,.12),P(.82,.25),P(.9,.88),P(.12,.76))
    private fun config(mode:String="grid")=Config(mode=mode,diagonals=false,planeCorners=corners,calibrationImageAspect=4.0/3)
    @Test fun perspectiveRoundTripAndCornerCorrespondence(){
        val g=Guide(config(),640,480)
        val square=listOf(P(0.0,0.0),P(1.0,0.0),P(1.0,1.0),P(0.0,1.0))
        square.zip(corners).forEach {(p,c)->assertTrue(g.project(p).distance(P(c.x*4/3,c.y))<1e-8)}
        val s=Segment(P(.3,.4),P(.65,.7));val restored=g.rectify(Segment(g.project(s.a),g.project(s.b)))!!
        assertTrue(restored.a.distance(s.a)<1e-8);assertTrue(restored.b.distance(s.b)<1e-8)
    }
    @Test fun skewedGridHasCorrectDistancesAnglesAndSymmetry(){
        val g=Guide(config(),640,480)
        val a=Segment(g.project(g.point(-1.0,-1.0)),g.project(g.point(-1.0,1.0)))
        val b=Segment(g.project(g.point(1.0,-1.0)),g.project(g.point(1.0,1.0)))
        val m=Scorer().score(1000,listOf(a,b),g)
        assertEquals(0.0,m.deviation!!,1e-7);assertEquals(0.0,m.angle!!,1e-7);assertEquals(0.0,m.symmetry!!,1e-7)
        assertEquals(4,g.cues(listOf(a,b)).count {it.onTarget})
    }
    @Test fun skewedCircleUsesRectifiedRadius(){
        val g=Guide(config("circles").copy(circleSeparation=.5),640,480)
        val staffs=g.circles.map {c->Segment(g.project(c+P(0.0,g.radius)),g.project(c-P(0.0,g.radius)))}
        assertEquals(0.0,Scorer().score(1000,staffs,g).deviation!!,1e-7)
        assertEquals(2,g.circlePaths.size);assertEquals(97,g.circlePaths[0].size)
    }
    @Test fun calibratedMeasurementsPreserveNonzeroError(){
        val flat=Guide(Config(diagonals=false),480,480);val angled=Guide(config(),640,480)
        val staffs=listOf(Segment(P(.23,.2),P(.25,.8)),Segment(P(.76,.23),P(.8,.7)))
        val projected=staffs.map {it.copy(a=angled.project(it.a),b=angled.project(it.b))}
        val expected=Scorer().score(1000,staffs,flat);val actual=Scorer().score(1000,projected,angled)
        assertEquals(expected.deviation!!,actual.deviation!!,1e-7);assertEquals(expected.angle!!,actual.angle!!,1e-7);assertEquals(expected.symmetry!!,actual.symmetry!!,1e-7)
    }
    @Test fun outsidePlaneAndChangedCropPauseScoresAndCues(){
        val g=Guide(config(),640,480);val s=Segment(P(0.0,0.0),P(.5,.5))
        assertNull(Scorer().score(1000,listOf(s,s),g).deviation);assertTrue(g.cues(listOf(s,s)).isEmpty())
        val changed=Guide(config(),480,640);assertNull(changed.rectify(s))
    }
    @Test fun invalidOrCrossedCornersAreRejected(){
        for(points in listOf(corners.reversed(),listOf(corners[0],corners[2],corners[1],corners[3]),List(4){P(.4,.4)},listOf(P(.1,.1)))){
            assertThrows(IllegalArgumentException::class.java){Config().patch(JSONObject().put("planeCorners",JSONArray(points.map {it.json()})))}
        }
    }
    @Test fun cameraZoomAndMirrorInvalidateCalibrationAndCameraDefaultsToWidest(){
        for(patch in listOf(JSONObject().put("zoom",2.0),JSONObject().put("facing","back"),JSONObject().put("mirror",false))){assertTrue(config().patch(patch).planeCorners.isEmpty())}
        assertEquals(0.0,config().copy(zoom=2.0).patch(JSONObject().put("facing","back")).zoom,0.0)
        assertTrue(Config().mirror)
    }
    @Test fun arrowsEndAtNearestGuideAndHideForUncertainTracking(){
        val g=Guide(Config(diagonals=false),480,480);val s=Segment(P(.2,.25),P(.2,.75));val t=Segment(P(.8,.25),P(.8,.75))
        val cues=g.cues(listOf(s,t));assertEquals(4,cues.size)
        cues.forEach {assertEquals(0.0,g.deviation(it.target),1e-8);assertEquals(g.deviation(it.tip)/(2*g.radius)*100,it.error,1e-7)}
        assertTrue(g.cues(listOf(s,t.copy(confidence=.2))).isEmpty())
        assertTrue(Guide(Config(mode="free"),480,480).cues(listOf(s,t)).isEmpty())
    }
}
