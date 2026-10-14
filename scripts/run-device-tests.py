#!/usr/bin/env python3
"""Run disposable-emulator integration checks, including a short camera recording."""
import argparse
import pathlib
import shutil
import subprocess

p=argparse.ArgumentParser()
p.add_argument('--adb',default='adb');p.add_argument('--serial',required=True)
p.add_argument('--windows-stage',type=pathlib.Path)
a=p.parse_args()
if not a.serial.startswith('emulator-'):
    raise SystemExit('These recording tests are restricted to a disposable emulator.')
root=pathlib.Path(__file__).resolve().parents[1]
for relative in ['app/build/outputs/apk/debug/app-debug.apk','app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk']:
    artifact=root/relative
    if a.windows_stage:
        a.windows_stage.mkdir(parents=True,exist_ok=True)
        staged=a.windows_stage/artifact.name;shutil.copy2(artifact,staged)
        argument=subprocess.check_output(['wslpath','-w',str(staged)],text=True).strip()
    else: argument=str(artifact)
    subprocess.run([a.adb,'-s',a.serial,'install','-r',argument],check=True)
result=subprocess.run([a.adb,'-s',a.serial,'shell','am','instrument','-w','-r','com.caleb.klobflow.debug.test/androidx.test.runner.AndroidJUnitRunner'],text=True,capture_output=True,check=True)
print(result.stdout)
if 'OK (1 test)' not in result.stdout:
    raise SystemExit('Device integration test did not pass.')
