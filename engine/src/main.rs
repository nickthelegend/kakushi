//! fhish-engine: the FHE half of the Fhish coprocessor on Monad.
//!
//! The Monad contracts never see plaintext and never do FHE math (an EVM can't). They emit a
//! symbolic graph of operations over 32-byte handles. This engine materializes that graph with
//! REAL Zama tfhe-rs ciphertexts, natively and multi-threaded:
//!
//!   serve   HTTP API on 127.0.0.1 (only the TS coprocessor talks to it)
//!   keygen  create the network keyset (client key = the secret decryption root)
//!   encrypt client-side encryption for Node tooling: a CompactCiphertextList under the public key
//!
//! Handle layout (matches FhishCoprocessor.sol): last byte = FhishType (0 ebool, 3 euint32, 4 euint64).
//! TRUST: today a single engine holds the client key (like Zama's testnet KMS). Threshold KMS is
//! roadmap; decryption is only ever performed after the coprocessor checks the on-chain ACL.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use axum::extract::{Path as AxPath, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Deserialize;
use serde_json::json;
use sha3::{Digest, Keccak256};
use tfhe::prelude::*;
use tfhe::safe_serialization::{safe_deserialize, safe_serialize};
use tfhe::{
    generate_keys, set_server_key, ClientKey, CompactCiphertextList, CompactPublicKey, ConfigBuilder, FheBool, FheUint32,
    FheUint64, ServerKey,
};

const LIMIT: u64 = 1 << 31;
const T_BOOL: u8 = 0;
const T_U32: u8 = 3;
const T_U64: u8 = 4;

#[derive(Clone)]
enum Ct {
    B(FheBool),
    U32(FheUint32),
    U64(FheUint64),
}

struct Keys {
    client: ClientKey,
    server: ServerKey,
    public: CompactPublicKey,
    public_bytes: Vec<u8>,
}

struct Engine {
    keys: Keys,
    dir: PathBuf,
    cache: Mutex<HashMap<String, Ct>>,
}

fn ser<T: serde::Serialize + tfhe::named::Named + tfhe::Versionize>(v: &T) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    safe_serialize(v, &mut out, LIMIT).map_err(|e| anyhow!("serialize: {e}"))?;
    Ok(out)
}

fn de<T: serde::de::DeserializeOwned + tfhe::named::Named + tfhe::Unversionize>(b: &[u8]) -> Result<T> {
    safe_deserialize(b, LIMIT).map_err(|e| anyhow!("deserialize: {e}"))
}

fn type_of(handle: &str) -> Result<u8> {
    let h = handle.trim_start_matches("0x");
    if h.len() != 64 {
        bail!("handle must be 32 bytes");
    }
    Ok(u8::from_str_radix(&h[62..64], 16)?)
}

fn norm(h: &str) -> String {
    h.trim_start_matches("0x").to_lowercase()
}

fn load_or_generate(dir: &Path) -> Result<Keys> {
    std::fs::create_dir_all(dir)?;
    let (c, s, p) = (dir.join("client_key.bin"), dir.join("server_key.bin"), dir.join("public_key.bin"));
    if c.exists() && s.exists() && p.exists() {
        let t = Instant::now();
        let client: ClientKey = de(&std::fs::read(&c)?)?;
        let server: ServerKey = de(&std::fs::read(&s)?)?;
        let public_bytes = std::fs::read(&p)?;
        let public: CompactPublicKey = de(&public_bytes)?;
        eprintln!("[engine] loaded keys from {} in {} ms", dir.display(), t.elapsed().as_millis());
        return Ok(Keys { client, server, public, public_bytes });
    }
    let t = Instant::now();
    let config = ConfigBuilder::default().build();
    let (client, server) = generate_keys(config);
    let public = CompactPublicKey::new(&client);
    let public_bytes = ser(&public)?;
    std::fs::write(&c, ser(&client)?)?;
    std::fs::write(&s, ser(&server)?)?;
    std::fs::write(&p, &public_bytes)?;
    eprintln!("[engine] generated keys in {} ms -> {}", t.elapsed().as_millis(), dir.display());
    Ok(Keys { client, server, public, public_bytes })
}

impl Engine {
    fn path(&self, h: &str) -> PathBuf {
        self.dir.join("ct").join(format!("{}.bin", norm(h)))
    }

    fn put(&self, h: &str, ct: Ct) -> Result<()> {
        let bytes = match &ct {
            Ct::B(x) => ser(x)?,
            Ct::U32(x) => ser(x)?,
            Ct::U64(x) => ser(x)?,
        };
        std::fs::create_dir_all(self.dir.join("ct"))?;
        std::fs::write(self.path(h), bytes)?;
        self.cache.lock().unwrap().insert(norm(h), ct);
        Ok(())
    }

    fn get(&self, h: &str) -> Result<Ct> {
        if let Some(c) = self.cache.lock().unwrap().get(&norm(h)) {
            return Ok(c.clone());
        }
        let p = self.path(h);
        let bytes = std::fs::read(&p).with_context(|| format!("ciphertext {h} not materialized"))?;
        let ct = match type_of(h)? {
            T_BOOL => Ct::B(de(&bytes)?),
            T_U32 => Ct::U32(de(&bytes)?),
            T_U64 => Ct::U64(de(&bytes)?),
            t => bail!("unsupported type {t}"),
        };
        self.cache.lock().unwrap().insert(norm(h), ct.clone());
        Ok(ct)
    }

    fn has(&self, h: &str) -> bool {
        self.cache.lock().unwrap().contains_key(&norm(h)) || self.path(h).exists()
    }
}

/// opcodes, identical to FhishCoprocessor.sol
fn binop(op: u8, a: &Ct, b: Option<&Ct>, scalar: Option<u64>) -> Result<Ct> {
    macro_rules! arith {
        ($x:expr, $y:expr, $s:expr, $T:ty, $wrap:path, $cast:ty) => {{
            let x: &$T = $x;
            match (op, $y, $s) {
                (1, _, Some(s)) => $wrap(x + (s as $cast)),
                (2, _, Some(s)) => $wrap(x - (s as $cast)),
                (3, _, Some(s)) => $wrap(x * (s as $cast)),
                (9, _, s) => $wrap(x << (s.unwrap_or(1) as $cast)),
                (10, _, s) => $wrap(x >> (s.unwrap_or(1) as $cast)),
                (22, _, _) => $wrap(!x),
                (13, _, Some(s)) => Ct::B(x.eq(s as $cast)),
                (14, _, Some(s)) => Ct::B(x.ne(s as $cast)),
                (15, _, Some(s)) => Ct::B(x.ge(s as $cast)),
                (16, _, Some(s)) => Ct::B(x.gt(s as $cast)),
                (17, _, Some(s)) => Ct::B(x.le(s as $cast)),
                (18, _, Some(s)) => Ct::B(x.lt(s as $cast)),
                (19, _, Some(s)) => $wrap(x.min(s as $cast)),
                (20, _, Some(s)) => $wrap(x.max(s as $cast)),
                (o, Some(y), None) => {
                    let y: &$T = y;
                    match o {
                        1 => $wrap(x + y),
                        2 => $wrap(x - y),
                        3 => $wrap(x * y),
                        6 => $wrap(x & y),
                        7 => $wrap(x | y),
                        8 => $wrap(x ^ y),
                        13 => Ct::B(x.eq(y)),
                        14 => Ct::B(x.ne(y)),
                        15 => Ct::B(x.ge(y)),
                        16 => Ct::B(x.gt(y)),
                        17 => Ct::B(x.le(y)),
                        18 => Ct::B(x.lt(y)),
                        19 => $wrap(x.min(y)),
                        20 => $wrap(x.max(y)),
                        _ => bail!("unsupported opcode {o}"),
                    }
                }
                (o, _, _) => bail!("unsupported opcode {o} / operand combination"),
            }
        }};
    }
    Ok(match a {
        Ct::U32(x) => {
            let y = match b {
                Some(Ct::U32(y)) => Some(y),
                Some(_) => bail!("type mismatch"),
                None => None,
            };
            arith!(x, y, scalar, FheUint32, Ct::U32, u32)
        }
        Ct::U64(x) => {
            let y = match b {
                Some(Ct::U64(y)) => Some(y),
                Some(_) => bail!("type mismatch"),
                None => None,
            };
            arith!(x, y, scalar, FheUint64, Ct::U64, u64)
        }
        Ct::B(x) => match (op, b) {
            (6, Some(Ct::B(y))) => Ct::B(x & y),
            (7, Some(Ct::B(y))) => Ct::B(x | y),
            (8, Some(Ct::B(y))) => Ct::B(x ^ y),
            (22, _) => Ct::B(!x),
            (13, Some(Ct::B(y))) => Ct::B(x.eq(y)),
            (14, Some(Ct::B(y))) => Ct::B(x.ne(y)),
            _ => bail!("unsupported ebool op {op}"),
        },
    })
}

fn trivial(value: u64, t: u8) -> Result<Ct> {
    Ok(match t {
        T_BOOL => Ct::B(FheBool::encrypt_trivial(value != 0)),
        T_U32 => Ct::U32(FheUint32::encrypt_trivial(value as u32)),
        T_U64 => Ct::U64(FheUint64::encrypt_trivial(value)),
        _ => bail!("unsupported type {t}"),
    })
}

#[derive(Deserialize)]
struct InputReq {
    handle: String,
    #[serde(rename = "type")]
    t: u8,
    list: String,
    index: Option<usize>,
}
#[derive(Deserialize)]
struct OpReq {
    op: u8,
    result: String,
    lhs: String,
    rhs: Option<String>,
    scalar: Option<String>,
}
#[derive(Deserialize)]
struct SelectReq {
    result: String,
    control: String,
    if_true: String,
    if_false: String,
}
#[derive(Deserialize)]
struct TrivialReq {
    result: String,
    value: String,
    #[serde(rename = "type")]
    t: u8,
}
#[derive(Deserialize)]
struct AliasReq {
    result: String,
    source: String,
}
#[derive(Deserialize)]
struct RandReq {
    result: String,
    seed: String,
    upper_bound: String,
    #[serde(rename = "type")]
    t: u8,
}
#[derive(Deserialize)]
struct HandleReq {
    handle: String,
}

type S = Arc<Engine>;

fn err(e: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": format!("{e:#}") })))
}

async fn blocking<F, T>(f: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f).await.map_err(|e| anyhow!("join: {e}"))?
}

fn with_key<T>(server: &ServerKey, f: impl FnOnce() -> T) -> T {
    set_server_key(server.clone());
    f()
}

fn parse_u64(s: &str) -> Result<u64> {
    if let Some(h) = s.strip_prefix("0x") {
        Ok(u64::from_str_radix(h, 16)?)
    } else {
        Ok(s.parse()?)
    }
}

async fn serve(dir: PathBuf, port: u16) -> Result<()> {
    let keys = load_or_generate(&dir.join("keys"))?;
    let engine = Arc::new(Engine { keys, dir: dir.clone(), cache: Mutex::new(HashMap::new()) });
    let app = Router::new()
        .route("/health", get(|State(e): State<S>| async move { Json(json!({ "ok": true, "tfhe": "1.8.1", "threads": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1), "cached": e.cache.lock().unwrap().len() })) }))
        .route("/public-key", get(|State(e): State<S>| async move { e.keys.public_bytes.clone() }))
        .route("/has/{handle}", get(|State(e): State<S>, AxPath(h): AxPath<String>| async move { Json(json!({ "has": e.has(&h) })) }))
        .route("/input", post(input))
        .route("/op", post(op))
        .route("/select", post(select))
        .route("/trivial", post(trivial_h))
        .route("/alias", post(alias))
        .route("/rand", post(rand))
        .route("/decrypt", post(decrypt))
        .with_state(engine);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    eprintln!("[engine] tfhe-rs 1.8.1 listening on 127.0.0.1:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn input(State(e): State<S>, Json(r): Json<InputReq>) -> impl IntoResponse {
    let res = blocking(move || {
        let t0 = Instant::now();
        let bytes = B64.decode(r.list.as_bytes())?;
        let list: CompactCiphertextList = de(&bytes)?;
        let idx = r.index.unwrap_or(0);
        let ct = with_key(&e.keys.server, || -> Result<Ct> {
            let ex = list.expand()?;
            Ok(match r.t {
                T_BOOL => Ct::B(ex.get::<FheBool>(idx)?.ok_or_else(|| anyhow!("no ebool at {idx}"))?),
                T_U32 => Ct::U32(ex.get::<FheUint32>(idx)?.ok_or_else(|| anyhow!("no euint32 at {idx}"))?),
                T_U64 => Ct::U64(ex.get::<FheUint64>(idx)?.ok_or_else(|| anyhow!("no euint64 at {idx}"))?),
                t => bail!("unsupported input type {t}"),
            })
        })?;
        e.put(&r.handle, ct)?;
        Ok(json!({ "ok": true, "ms": t0.elapsed().as_millis() }))
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(x) => err(x).into_response(),
    }
}

async fn op(State(e): State<S>, Json(r): Json<OpReq>) -> impl IntoResponse {
    let res = blocking(move || {
        let t0 = Instant::now();
        let a = e.get(&r.lhs)?;
        let b = match &r.rhs {
            Some(h) => Some(e.get(h)?),
            None => None,
        };
        let s = match &r.scalar {
            Some(v) => Some(parse_u64(v)?),
            None => None,
        };
        let out = with_key(&e.keys.server, || binop(r.op, &a, b.as_ref(), s))?;
        e.put(&r.result, out)?;
        Ok(json!({ "ok": true, "ms": t0.elapsed().as_millis() }))
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(x) => err(x).into_response(),
    }
}

async fn select(State(e): State<S>, Json(r): Json<SelectReq>) -> impl IntoResponse {
    let res = blocking(move || {
        let t0 = Instant::now();
        let c = match e.get(&r.control)? {
            Ct::B(b) => b,
            _ => bail!("control must be ebool"),
        };
        let (a, b) = (e.get(&r.if_true)?, e.get(&r.if_false)?);
        let out = with_key(&e.keys.server, || -> Result<Ct> {
            Ok(match (a, b) {
                (Ct::U32(x), Ct::U32(y)) => Ct::U32(c.select(&x, &y)),
                (Ct::U64(x), Ct::U64(y)) => Ct::U64(c.select(&x, &y)),
                (Ct::B(x), Ct::B(y)) => Ct::B(c.select(&x, &y)),
                _ => bail!("select type mismatch"),
            })
        })?;
        e.put(&r.result, out)?;
        Ok(json!({ "ok": true, "ms": t0.elapsed().as_millis() }))
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(x) => err(x).into_response(),
    }
}

async fn trivial_h(State(e): State<S>, Json(r): Json<TrivialReq>) -> impl IntoResponse {
    let res = blocking(move || {
        let v = parse_u64(&r.value)?;
        let ct = with_key(&e.keys.server, || trivial(v, r.t))?;
        e.put(&r.result, ct)?;
        Ok(json!({ "ok": true }))
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(x) => err(x).into_response(),
    }
}

/// result handle refers to the same ciphertext as `source` (VerifyInput binding, same-size Cast)
async fn alias(State(e): State<S>, Json(r): Json<AliasReq>) -> impl IntoResponse {
    let res = blocking(move || {
        let ct = e.get(&r.source)?;
        e.put(&r.result, ct)?;
        Ok(json!({ "ok": true }))
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(x) => err(x).into_response(),
    }
}

/// Verifiable randomness: value = keccak256(seed ‖ result) mod upperBound, encrypted.
/// DEMO ASSUMPTION: the engine sees the value; production uses tfhe's oblivious PRNG.
async fn rand(State(e): State<S>, Json(r): Json<RandReq>) -> impl IntoResponse {
    let res = blocking(move || {
        let mut k = Keccak256::new();
        k.update(hex::decode(norm(&r.seed))?);
        k.update(hex::decode(norm(&r.result))?);
        let d = k.finalize();
        let raw = u64::from_be_bytes(d[24..32].try_into().unwrap());
        let ub = parse_u64(&r.upper_bound)?;
        let v = if ub == 0 { raw } else { raw % ub };
        let ct = with_key(&e.keys.server, || trivial(v, r.t))?;
        e.put(&r.result, ct)?;
        Ok(json!({ "ok": true }))
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(x) => err(x).into_response(),
    }
}

/// Decrypt one handle. ONLY the coprocessor calls this, after it checked the on-chain ACL.
async fn decrypt(State(e): State<S>, Json(r): Json<HandleReq>) -> impl IntoResponse {
    let res = blocking(move || {
        let ct = e.get(&r.handle)?;
        let v: String = match ct {
            Ct::B(x) => (if x.decrypt(&e.keys.client) { 1u64 } else { 0 }).to_string(),
            Ct::U32(x) => {
                let d: u32 = x.decrypt(&e.keys.client);
                d.to_string()
            }
            Ct::U64(x) => {
                let d: u64 = x.decrypt(&e.keys.client);
                d.to_string()
            }
        };
        Ok(json!({ "value": v }))
    })
    .await;
    match res {
        Ok(v) => Json(v).into_response(),
        Err(x) => err(x).into_response(),
    }
}

fn arg<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(|s| s.as_str())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");
    let dir = PathBuf::from(arg(&args, "--dir").unwrap_or(".fhish"));
    match cmd {
        "serve" => {
            let port: u16 = arg(&args, "--port").unwrap_or("8799").parse()?;
            tokio::runtime::Runtime::new()?.block_on(serve(dir, port))
        }
        "keygen" => {
            load_or_generate(&dir.join("keys"))?;
            Ok(())
        }
        // Client-side encryption for Node tooling: values never leave the caller's machine.
        // fhish-engine encrypt --pk public_key.bin --type 3 --value 41  -> base64 CompactCiphertextList
        "encrypt" => {
            let pk_path = arg(&args, "--pk").ok_or_else(|| anyhow!("--pk <public_key.bin> required"))?;
            let t: u8 = arg(&args, "--type").unwrap_or("3").parse()?;
            let value = parse_u64(arg(&args, "--value").ok_or_else(|| anyhow!("--value required"))?)?;
            let pk: CompactPublicKey = de(&std::fs::read(pk_path)?)?;
            let mut b = CompactCiphertextList::builder(&pk);
            match t {
                T_BOOL => b.push(value != 0),
                T_U32 => b.push(value as u32),
                T_U64 => b.push(value),
                _ => bail!("unsupported type {t}"),
            };
            let list = b.build();
            println!("{}", B64.encode(ser(&list)?));
            Ok(())
        }
        _ => {
            eprintln!("usage: fhish-engine serve|keygen|encrypt [--dir .fhish] [--port 8799] [--pk f --type 3 --value n]");
            Ok(())
        }
    }
}
