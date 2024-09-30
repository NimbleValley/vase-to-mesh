import * as tmp from "tmp";
import * as fs from "fs";
import { Blob as NodeBlob } from "buffer";

const EventTarget: EventTargetConstructor = require("eventtarget");

interface EventBeforeDispatch {
  [key: string]: any;
  type: string;
}

interface Event {
  readonly cancelable: boolean;
  readonly defaultPrevented: boolean;
  readonly isTrusted: boolean;
  readonly target: EventTarget | null;
  readonly timeStamp: number;
  readonly bubbles: boolean;
  /** @deprecated */
  cancelBubble: boolean;
  readonly composed: boolean;
  readonly currentTarget: EventTarget | null;
  readonly eventPhase: number;
  /** @deprecated */
  returnValue: boolean;
  /** @deprecated */
  readonly srcElement: EventTarget | null;
  readonly type: string;

  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  composedPath(): EventTarget[];
  /** @deprecated */
  initEvent(type: string, bubbles: boolean, cancelable: boolean): void;

  readonly NONE: number;
  readonly CAPTURING_PHASE: number;
  readonly AT_TARGET: number;
  readonly BUBBLING_PHASE: number;
}

interface EventTarget {
  addEventListener(type: string, listener: (event: Event) => void);
  removeEventListener(type: string, listener: (event: Event) => void);
  dispatchEvent(event: EventBeforeDispatch);
}

interface ProgressEvent<T extends EventTarget = EventTarget> extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly target: T | null;
  readonly total: number;
}

interface EventTargetConstructor {
  new (): EventTarget;
}

interface FileReaderEvent extends Event {}

function getTempPath(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    tmp.tmpName((err, path) => {
      if (err) reject(err);
      else {
        tempFiles.add(path);
        resolve(path);
      }
    });
  });
}

function fdopen(path: string, flags: string): Promise<number> {
  return new Promise<number>((resolve, reject) =>
    fs.open(path, flags, (err, fd) => {
      if (err) reject(err);
      else resolve(fd);
    })
  );
}

function fdclose(fd: number): Promise<void> {
  return new Promise((resolve, reject) =>
    fs.close(fd, (err) => {
      if (err) reject(err);
      else resolve();
    })
  );
}

function fdwriteFile(fd: number, path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(<any>null, { fd });
    const reader = fs.createReadStream(path);
    reader.on("error", reject);
    reader.on("end", resolve);
    writer.on("error", reject);
    reader.pipe(writer, { end: false });
  });
}

function fdwrite(fd: number, str: string | Uint8Array): Promise<void> {
  return new Promise((resolve, reject) =>
    fs.write(fd, str as any, (err) => {
      if (err) reject(err);
      else resolve();
    })
  );
}

function fdread(fd: number, size: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(size);
  return new Promise<Buffer>((resolve, reject) =>
    fs.read(fd, buffer, 0, size, position, (err) => {
      if (err) reject(err);
      else resolve(buffer);
    })
  );
}

const tempFiles: Set<string> = new Set();

const onExit: Array<() => void> = [];

process.on("exit", (code) => {
  for (const cb of onExit) cb();
  process.exit(code);
});

onExit.push(() => {
  for (const file of tempFiles) {
    fs.unlinkSync(file);
  }
});

interface BlobPropertyBag {
  type?: string;
  ending?: "transparent" | "native";
}

export interface Blob {
  readonly size: number;
  readonly type: string;
  slice(start?: number, end?: number, contentType?: string): Blob;
}

export interface FileReader extends EventTarget {
  readonly error: any | null;
  readonly readyState: number;
  readonly result: any;
  readonly EMPTY: number;
  readonly LOADING: number;
  readonly DONE: number;

  onabort: ((ev: ProgressEvent<FileReader>) => void) | null;
  onerror: ((ev: FileReaderEvent) => void) | null;
  onload: ((ev: FileReaderEvent) => void) | null;
  onloadstart: ((ev: FileReaderEvent) => void) | null;
  onloadend: ((ev: FileReaderEvent) => void) | null;
  onprogress: ((ev: FileReaderEvent) => void) | null;

  abort(): void;
  readAsArrayBuffer(blob: Blob): void;
  readAsBinaryString(blob: Blob): void;
  readAsDataURL(blob: Blob): void;
  readAsText(blob: Blob): void;
}

export class VBlob implements Blob {
  _path: string = "";
  _size: number;
  _offset: number = 0;
  _type: string;
  _writeTask: Promise<number> = Promise.resolve(0);

  private _write(fn: (fd: number) => void | Promise<void>): void {
    this._writeTask = this._writeTask.then(async (fd) => {
      if (!fd) {
        this._path = await getTempPath();
        fd = await fdopen(this._path, "w+");
      }
      await fn(fd);
      return fd;
    });
  }

  private _writeEnd(): void {
    this._writeTask = this._writeTask.then((fd) => fdclose(fd)).then(() => 0);
  }

  constructor(array?: any[], options?: BlobPropertyBag) {
    this._type = (options && options.type) || "";

    if (!array) {
      this._path = "";
      this._size = 0;
    } else {
      var size = 0;
      for (const value of array) {
        if (value instanceof ArrayBuffer) {
          if (value.byteLength === 0) continue;
          this._write((fd) => fdwrite(fd, new Uint8Array(value)));
          size += value.byteLength;
        } else if (value instanceof Uint8Array) {
          if (value.byteLength === 0) continue;
          this._write((fd) => fdwrite(fd, value));
          size += value.byteLength;
        } else if (
          value instanceof Int8Array ||
          value instanceof Uint8ClampedArray ||
          value instanceof Int16Array ||
          value instanceof Uint16Array ||
          value instanceof Int32Array ||
          value instanceof Uint32Array ||
          value instanceof Float32Array ||
          value instanceof Float64Array ||
          value instanceof DataView
        ) {
          if (value.byteLength === 0) continue;
          this._write((fd) =>
            fdwrite(
              fd,
              new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            )
          );
          size += value.byteLength;
        } else if (value instanceof VBlob) {
          if (value._size === 0) continue;
          this._write((fd) => fdwriteFile(fd, value._path));
          size += value._size;
        } else {
          const str = value + "";
          if (str.length === 0) continue;
          this._write((fd) => fdwrite(fd, str));
          size += str.length;
        }
      }
      this._writeEnd();
      this._size = size;
    }
  }

  get size(): number {
    return this._size;
  }

  get type(): string {
    return this._type;
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    if (!start) start = 0;
    else if (start < 0) start = this._size + start;
    if (!end) end = this._size;

    if (end < 0) end = this._size - end;
    else if (end >= this._size) end = this._size;
    if (start >= end) return new VBlob([]);

    const newblob = new VBlob();
    newblob._type = contentType || this._type;
    newblob._writeTask = this._writeTask;
    newblob._offset = this._offset + start;
    newblob._size = end - start;
    this._writeTask.then(() => (newblob._path = this._path));
    return newblob;
  }

  readBuffer(fd: number): Promise<ArrayBuffer> {
    return fdread(fd, this._size, this._offset).then((buffer) => buffer.buffer);
  }
}

export var Blob: { new (array?: any[], options?: BlobPropertyBag): Blob } =
  global["Blob"] || VBlob;

interface Aborted {
  aborted: boolean;
}
export class VFileReader extends EventTarget implements FileReader {
  static readonly EMPTY = 0;
  static readonly LOADING = 1;
  static readonly DONE = 2;
  readonly EMPTY = 0;
  readonly LOADING = 1;
  readonly DONE = 2;

  onabort: ((ev: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((ev: FileReaderEvent) => void) | null = null;
  onload: ((ev: FileReaderEvent) => void) | null = null;
  onloadstart: ((ev: FileReaderEvent) => void) | null = null;
  onloadend: ((ev: FileReaderEvent) => void) | null = null;
  onprogress: ((ev: FileReaderEvent) => void) | null = null;

  private _readyState: 0 | 1 | 2;
  private _abort: (() => void) | null = null;
  private _abortPromise: Promise<null> | null = null;

  public result: any;
  public error: any | null = null;

  constructor() {
    super();
    this._readyState = 0;
  }

  get readyState(): 0 | 1 | 2 {
    return this._readyState;
  }

  abort(): void {
    if (this._abort !== null) {
      this._abort();
      this._abort = null;
      this._abortPromise = null;
      this.dispatchEvent({ type: "abort" });
    }
    if (this._readyState === 1) {
      this._finishWork();
    }
  }

  private _startWork(methodName: string): Aborted {
    if (this._readyState === 1) {
      throw Error(
        `Failed to execute '${methodName}' on 'FileReader': The object is already busy reading Blobs.`
      );
    }
    this.result = null;
    this.error = null;
    this._readyState = 1;
    const aborted: Aborted = { aborted: false };
    if (this._abortPromise === null) {
      this._abortPromise = new Promise<null>((resolve) => {
        this._abort = () => {
          aborted.aborted = true;
          resolve(null);
        };
      });
    }
    return aborted;
  }

  private _finishWork() {
    this.dispatchEvent({ type: "loadend" });
    this._readyState = 2;
  }

  private _readBuffer(
    methodName: string,
    blob: Blob,
    cb: (buffer: Buffer) => any
  ): Promise<void> {
    const aborted = this._startWork(methodName);

    if (!(blob instanceof VBlob) && !(blob instanceof NodeBlob)) {
      throw TypeError(
        `vblob cannot handle the ${blob.constructor.name} class.`
      );
    }

    const prom = new Promise((resolve) => process.nextTick(resolve)).then(
      () => {
        if (aborted.aborted) return null;
        this.dispatchEvent({ type: "loadstart" });
        if (blob instanceof VBlob) {
          return this._readVBlob(blob);
        } else if (blob instanceof NodeBlob) {
          return this._readNodeBlob(blob);
        } else {
          return null;
        }
      }
    );
    return Promise.race([this._abortPromise, prom]).then(
      (data) => {
        if (data === null) return;
        if (aborted.aborted) return;
        this.result = cb(data);
        this.dispatchEvent({ type: "load" });
        this._finishWork();
      },
      (err) => {
        if (aborted.aborted) return;
        this.error = err;
        this.dispatchEvent({
          type: "error",
          message: err ? err.message : "Error",
        });
        this._finishWork();
      }
    );
  }

  private async _readVBlob(blob: VBlob): Promise<Buffer> {
    if (blob._size === 0) {
      return Buffer.alloc(0);
    } else {
      await blob._writeTask;
      const fd = await fdopen(blob._path, "r");
      try {
        return await fdread(fd, blob._size, blob._offset);
      } finally {
        fdclose(fd);
      }
    }
  }

  private async _readNodeBlob(blob: NodeBlob): Promise<Buffer> {
    const buf = await blob.arrayBuffer();
    return Buffer.from(buf);
  }

  readAsArrayBuffer(blob: Blob): void {
    this._readBuffer("readAsArrayBuffer", blob, (data) => data.buffer);
  }
  readAsBinaryString(blob: Blob): void {
    this._readBuffer("readAsBinaryString", blob, (data) =>
      data.toString("binary")
    );
  }
  readAsDataURL(blob: Blob): void {
    this._readBuffer(
      "readAsDataURL",
      blob,
      (data) =>
        "data:" +
        (blob.type || "application/octet-stream") +
        ";base64," +
        data.toString("base64")
    );
  }
  readAsText(blob: Blob): void {
    this._readBuffer("readAsText", blob, (data) => data.toString());
  }
}

export var FileReader: { new (): FileReader } =
  global["FileReader"] || VFileReader;
