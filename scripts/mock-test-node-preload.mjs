// The restricted Windows runner can fail os.userInfo() with ENOMEM before tsx starts.
import os from "node:os";

os.userInfo = () => ({ uid: -1, gid: -1, username: "mock-test", homedir: "/", shell: null });
