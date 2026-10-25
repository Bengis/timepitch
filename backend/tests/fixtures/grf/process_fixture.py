"""Process-boundary fixture only; does not emulate football or GRF output."""
import sys,time
mode=sys.argv[1]
if mode=='sleep':time.sleep(60)
elif mode=='stdout':sys.stdout.buffer.write(b'x'*200000);sys.stdout.flush();time.sleep(60)
elif mode=='stderr':sys.stderr.buffer.write(b'x'*200000);sys.stderr.flush();time.sleep(60)
elif mode=='invalid':print('{}')
elif mode=='exit':sys.exit(3)
