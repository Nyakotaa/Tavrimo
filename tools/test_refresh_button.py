from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
import json, time

ROOT = Path(__file__).resolve().parents[1]
PORT = 8765
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def main():
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Quiet)
    # Serve project root
    import os
    os.chdir(ROOT)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            context = browser.new_context(service_workers='block', viewport={'width': 390, 'height': 844}, is_mobile=True)
            page = context.new_page()
            requests = []
            page.route('**/api/rea/schedule*', lambda route: (requests.append(route.request.url), route.fulfill(status=200, content_type='application/json', body=json.dumps({
                'ics': 'BEGIN:VCALENDAR\\r\\nVERSION:2.0\\r\\nBEGIN:VEVENT\\r\\nUID:test1\\r\\nDTSTART;TZID=Europe/Moscow:20260930T083000\\r\\nDTEND;TZID=Europe/Moscow:20260930T100000\\r\\nSUMMARY:Математика\\r\\nLOCATION:302\\r\\nEND:VEVENT\\r\\nEND:VCALENDAR\\r\\n',
                'hash':'testhash'
            }))))
            page.add_init_script("""
              localStorage.setItem('tavrimo-planner-v16', JSON.stringify({
                version:16,
                settings:{workStart:9,workEnd:18,lunchStart:13,lunchEnd:14,buffer:10,focusLength:25,weekends:false,theme:'system'},
                tasks:[],focus:{totalMinutes:0,sessions:[]},
                university:{groupCode:'15.14д-ГГ04/266',groupName:'15.14д-ГГ04/266',importedAt:null,lastSyncAt:null,syncHash:'',syncError:'',syncMode:'auto',source:'rasp.rea.ru',events:[]}
              }));
            """)
            page.goto(f'http://127.0.0.1:{PORT}/index.html', wait_until='networkidle')
            page.wait_for_timeout(1200)
            btn = page.locator('#homeSyncBtn')
            assert btn.count() == 1, 'refresh button missing'
            assert btn.is_enabled(), 'refresh button disabled after initial sync'
            before = len(requests)
            btn.click()
            page.wait_for_timeout(250)
            assert len(requests) >= before + 1, f'refresh click did not create a new request: {len(requests)} vs {before}'
            assert 'Обновляю' in btn.inner_text() or btn.is_enabled(), 'button gave no visible response'
            page.wait_for_timeout(800)
            assert btn.is_enabled(), 'refresh button stayed disabled'
            errors = page.locator('[role="alert"]')
            print('Browser refresh UI test passed. Requests:', len(requests))
            print('Button text after sync:', btn.inner_text())
            browser.close()
    finally:
        server.shutdown()

if __name__ == '__main__':
    main()
