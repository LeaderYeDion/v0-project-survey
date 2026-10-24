"""Development-only HTTP model: python backend/tests/model_fixture.py --port 8999."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
import threading
import time


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address):
        super().__init__(address, Handler)
        self.records = []
        self.lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, status, value):
        body=json.dumps(value,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        with self.server.lock:
            records=list(self.server.records)
        self.send_json(200, records if self.path=='/requests' else {'status':'ok','source':'test'})

    def do_POST(self):
        if self.path!='/v1/chat/completions':
            return self.send_json(404, {'error':'not found'})
        try:
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            data=json.loads(body['messages'][-1]['content'])
            question=data['question']
            with self.server.lock:
                self.server.records.append(data)
            text=question['question']
            if '[delay=' in text:
                time.sleep(min(90, max(0,float(text.split('[delay=')[1].split(']')[0]))))
            if '[error]' in text:
                return self.send_json(503,{'error':'controlled fixture failure'})
            value=(question['options'][0] if question['type']=='choice' else
                   question['scale']['min'] if question['type']=='scale' else
                   f"HTTP FIXTURE {data['locale']} {data['respondent']['city']} history={len(data['history'])}")
            result={'questionId':question['id'], 'content':str(value),
                    'answerValue':{'type':question['type'],'value':value}}
            content='not-json' if '[invalid]' in text else json.dumps(result,ensure_ascii=False)
            self.send_json(200, {'choices':[{'message':{'content':content}}]})
        except (ValueError,KeyError,TypeError):
            self.send_json(400,{'error':'invalid fixture request'})


@contextmanager
def serve_fixture(port=0):
    server=FixtureServer(('127.0.0.1',port))
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8999)
    args=parser.parse_args()
    server=FixtureServer(('127.0.0.1',args.port))
    print(f'HTTP TEST FIXTURE listening on 127.0.0.1:{args.port}',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
