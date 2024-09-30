import { Blob, FileReader, VBlob } from "./index";

class Reader extends FileReader {
  public log = "";

  constructor() {
    super();
    this.addEventListener("loadstart", () => {
      this.log += "loadstart\n";
    });
    this.addEventListener("loadend", () => {
      this.log += "loadend\n";
    });
    this.addEventListener("error", () => {
      this.log += "error\n";
    });
    this.addEventListener("abort", () => {
      this.log += "abort\n";
    });
    this.addEventListener("load", () => {
      this.log += "load: ";
      const res = this.result;
      if (typeof res === "string") {
        this.log += "[string]" + res;
      } else {
        if (res instanceof ArrayBuffer) {
          this.log += "[ArrayBuffer]" + new TextDecoder().decode(res);
        } else {
          this.log += `[${res.constructor.name}]`;
        }
      }
      this.log += "\n";
    });
  }
  waitstart(): Promise<void> {
    return new Promise((resolve) => {
      this.onloadstart = () => {
        resolve();
      };
    });
  }
  waitEnd(): Promise<string> {
    this.log += "wait\n";
    return new Promise((resolve) => {
      if (this.log.indexOf("\nloadend\n") !== -1) {
        resolve(this.log);
        this.log = "";
        return;
      }
      const finish = () => {
        this.onabort = null;
        this.onloadend = null;
        clearTimeout(timeout);
        resolve(this.log);
        this.log = "";
      };
      this.onabort = finish;
      this.onloadend = finish;
      const timeout = setTimeout(() => {
        this.log += "timeout\n";
        finish();
      }, 1000);
    });
  }
}

function testWith(
  Blob: new (args?: (string | Uint8Array | number | ArrayBuffer)[]) => Blob
) {
  const blob = new Blob([
    "0",
    "1",
    "2",
    new Uint8Array([0x33, 0x34, 0x35]),
    67,
    new Uint8Array([0x38, 0x39]).buffer,
  ]);

  test(Blob.name, async () => {
    const reader = new Reader();
    expect(blob.size).toBe(10);

    expect(reader.readyState).toBe(0);
    reader.readAsArrayBuffer(blob);
    expect(reader.readyState).toBe(1);
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [ArrayBuffer]0123456789\nloadend\n"
    );
    expect(reader.readyState).toBe(2);

    let res = "none";
    reader.onload = function () {
      res = reader.result;
    };
    reader.readAsText(new Blob());
    expect(reader.result).toBe(null);
    expect(reader.readyState).toBe(1);
    expect(res).toBe("none");
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [string]\nloadend\n"
    );

    reader.readAsBinaryString(blob);
    expect(() => reader.readAsBinaryString(blob)).toThrow(
      "Failed to execute 'readAsBinaryString' on 'FileReader': The object is already busy reading Blobs."
    );
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [string]0123456789\nloadend\n"
    );
    reader.readAsDataURL(blob);
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [string]data:application/octet-stream;base64,MDEyMzQ1Njc4OQ==\nloadend\n"
    );
    reader.readAsText(blob);
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [string]0123456789\nloadend\n"
    );
  });

  test(Blob.name + " sliced", async () => {
    const reader = new Reader();
    const sliced = blob.slice(5, 10);
    expect(sliced.size).toBe(5);

    reader.readAsArrayBuffer(sliced);
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [ArrayBuffer]56789\nloadend\n"
    );
    reader.readAsBinaryString(sliced);
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [string]56789\nloadend\n"
    );
    reader.readAsDataURL(sliced);
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [string]data:application/octet-stream;base64,NTY3ODk=\nloadend\n"
    );
    reader.readAsText(sliced);
    expect(await reader.waitEnd()).toBe(
      "wait\nloadstart\nload: [string]56789\nloadend\n"
    );
  });

  test(Blob.name + " timeout", async () => {
    const reader = new Reader();
    reader.abort();
    expect(reader.readyState).toBe(0);
    reader.readAsText(blob);
    reader.abort();
    expect(reader.readyState).toBe(2);
    expect(await reader.waitEnd()).toBe("abort\nloadend\nwait\n");

    reader.readAsText(blob);
    await reader.waitstart();
    reader.abort();
    expect(await reader.waitEnd()).toBe("loadstart\nabort\nloadend\nwait\n");
  });
}

testWith(Blob);
testWith(VBlob);
