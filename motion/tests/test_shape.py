import pytest
import cv2
import numpy as np

from motion.shape import StaffShape


def mask(a,b):
    image=np.zeros((200,300),np.uint8)
    cv2.line(image,a,b,1,5)
    return image


def test_one_hidden_half_preserves_length_and_marks_inference():
    tracker=StaffShape([[.2,.5],[.8,.5]],300,200)
    for i in range(8):
        tracker.update(mask((60,100),(240,100)),i/60)
    result=tracker.update(mask((150,100),(240,100)),8/60)
    assert [p['state'] for p in result['ends']] == ['inferred','visible']
    assert abs(result['midpoint']['x']-.5)<.03
    assert result['midpoint']['state']=='inferred'
    assert result['visibleExtent'][0][0]>.4
    assert result['ends'][0]['x']<.25


def test_motion_is_not_attracted_to_initial_center():
    tracker=StaffShape([[.2,.5],[.8,.5]],300,200)
    for i in range(20):
        result=tracker.update(mask((60+i,100-i),(240+i,100-i)),i/60)
    assert result['midpoint']['x']>.55
    assert result['midpoint']['y']<.45
    assert all(p['state']=='visible' for p in result['ends'])


def test_a_longer_projected_view_is_not_truncated_to_initial_length():
    tracker=StaffShape([[.3,.5],[.7,.5]],300,200)
    tracker.update(mask((90,100),(210,100)),0)
    result=tracker.update(mask((60,100),(240,100)),.125)
    assert all(p['state']=='visible' for p in result['ends'])
    assert result['ends'][0]['x']<.22
    assert result['ends'][1]['x']>.78
    assert result['midpoint']['x']==pytest.approx(.5,abs=.01)


def test_empty_mask_is_an_estimate_not_observed_points():
    tracker=StaffShape([[.2,.5],[.8,.5]],300,200)
    tracker.update(mask((60,100),(240,100)),0)
    result=tracker.update(np.zeros((200,300),np.uint8),.3)
    assert all(p['state']=='inferred' and p['confidence']==0 for p in result['ends'])
    assert result['visibleExtent'] is None
    assert result['gapSeconds']==.3


def test_rotation_wraps_without_endpoint_teleportation():
    tracker=StaffShape([[.8,.5],[.2,.5]],300,200)
    previous=None
    for i,angle in enumerate(np.linspace(np.pi-.1,np.pi+.1,15)):
        delta=np.array([np.cos(angle),np.sin(angle)])*90
        a=np.rint(np.array([150,100])-delta).astype(int)
        b=np.rint(np.array([150,100])+delta).astype(int)
        result=tracker.update(mask(tuple(a),tuple(b)),i/60)
        point=np.array([result['ends'][0]['x'],result['ends'][0]['y']])
        if previous is not None: assert np.linalg.norm(point-previous)<.05
        previous=point
