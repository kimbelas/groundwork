@echo off
rem Groundwork - http://127.0.0.1:4848 (your machine only)
cd /d %~dp0
start "" http://127.0.0.1:4848
pnpm dev
