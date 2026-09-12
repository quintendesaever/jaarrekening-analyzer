import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAnalyzeJob,
  computeRatios,
  getAnalyzeJob,
  startAnalyzeJob,
} from "../api/client";
import {
  loadCachedAnalysis,
  saveCachedAnalysis,
} from "../persistence/analysisCache";
import type {
  AnalysisResult,
  AnalysisStatus,
  AnalyzeJobStatus,
  RatioResult,
} from "../types";
import { hashFile } from "../utils/hash";

const POLL_MS = 400;
const RECOMPUTE_DEBOUNCE_MS = 400;

export type RecomputeState = "idle" | "updating" | "failed";

function clearLegacySandboxStorage() {
  localStorage.removeItem("ratioSandboxDraft");
  sessionStorage.removeItem("ratioSandboxDraft");
  sessionStorage.removeItem("ratioSandboxEnabled");
}

export function useAnalysisSession() {
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [stale, setStale] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [job, setJob] = useState<AnalyzeJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorStageLabel, setErrorStageLabel] = useState<string | null>(null);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const [restoreReady, setRestoreReady] = useState(false);

  const [recomputeState, setRecomputeState] = useState<RecomputeState>("idle");
  const [recomputeError, setRecomputeError] = useState<string | null>(null);
  const [overlayRatios, setOverlayRatios] = useState<RatioResult[] | null>(null);
  const [overlayValidations, setOverlayValidations] = useState<string[] | null>(
    null,
  );

  const jobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const resultRef = useRef<AnalysisResult | null>(null);
  const recomputeTimerRef = useRef<number | null>(null);
  const recomputeGenRef = useRef(0);

  resultRef.current = result;

  const revokePdf = useCallback(() => {
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
  }, []);

  const setPdfFromBlob = useCallback(
    (blob: Blob, fileName: string) => {
      revokePdf();
      const url = URL.createObjectURL(blob);
      pdfUrlRef.current = url;
      setPdfUrl(url);
      const file =
        blob instanceof File
          ? blob
          : new File([blob], fileName, { type: "application/pdf" });
      setPdfFile(file);
    },
    [revokePdf],
  );

  useEffect(() => {
    let cancelled = false;
    sessionStorage.removeItem("analysisResult");
    clearLegacySandboxStorage();
    (async () => {
      try {
        const cached = await loadCachedAnalysis();
        if (cancelled || !cached) return;
        setPdfFromBlob(cached.pdfBlob, cached.fileName);
        setResult(cached.analysis);
        setContentHash(cached.contentHash);
        setStatus("completed");
        setStale(false);
      } catch {
        // Cache is optional; stay idle.
      } finally {
        if (!cancelled) setRestoreReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setPdfFromBlob]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
      revokePdf();
    };
  }, [revokePdf]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const applyJobFailure = useCallback((payload: AnalyzeJobStatus) => {
    setJob(payload);
    setStatus("error");
    setError(payload.error ?? "Analyse mislukt.");
    setErrorDetail(payload.error_detail);
    setErrorStageLabel(payload.error_stage_label);
    setStale(false);
  }, []);

  const applyJobSuccess = useCallback(
    async (payload: AnalyzeJobStatus, file: File) => {
      if (!payload.result) return;
      // Hash is best-effort: never hide a completed analysis if hashing fails
      // (e.g. older builds without a crypto.subtle fallback on plain HTTP).
      let hash: string | null = null;
      try {
        hash = await hashFile(file);
      } catch {
        // Continue without contentHash / cache.
      }
      setResult(payload.result);
      setContentHash(hash);
      setStale(false);
      setStatus("completed");
      setError(null);
      setErrorDetail(null);
      setErrorStageLabel(null);
      setCancelMessage(null);
      setOverlayRatios(null);
      setOverlayValidations(null);
      setRecomputeState("idle");
      setRecomputeError(null);
      if (hash) {
        try {
          await saveCachedAnalysis(payload.result, file, file.name);
        } catch {
          // Persistence failure must not hide a successful analysis.
        }
      }
    },
    [],
  );

  const pollJob = useCallback(
    async (jobId: string, file: File) => {
      if (jobIdRef.current !== jobId) return;
      try {
        const payload = await getAnalyzeJob(jobId);
        if (jobIdRef.current !== jobId) return;
        setJob(payload);
        if (payload.status === "completed") {
          stopPolling();
          jobIdRef.current = null;
          await applyJobSuccess(payload, file);
          return;
        }
        if (payload.status === "error") {
          stopPolling();
          jobIdRef.current = null;
          applyJobFailure(payload);
          return;
        }
        if (payload.status === "canceled") {
          stopPolling();
          jobIdRef.current = null;
          setJob(payload);
          if (resultRef.current) {
            setStatus("completed");
            setStale(false);
            setCancelMessage(null);
          } else {
            setStatus("canceled");
            setCancelMessage("Analyse geannuleerd.");
          }
          return;
        }
        pollTimerRef.current = window.setTimeout(() => {
          void pollJob(jobId, file);
        }, POLL_MS);
      } catch (err) {
        if (jobIdRef.current !== jobId) return;
        stopPolling();
        jobIdRef.current = null;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Status ophalen mislukt.");
        setStale(false);
      }
    },
    [applyJobFailure, applyJobSuccess, stopPolling],
  );

  const startAnalysis = useCallback(
    async (file: File) => {
      stopPolling();
      const previousJobId = jobIdRef.current;
      if (previousJobId) {
        jobIdRef.current = null;
        void cancelAnalyzeJob(previousJobId).catch(() => undefined);
      }

      setPdfFromBlob(file, file.name);
      setStatus("analyzing");
      setError(null);
      setErrorDetail(null);
      setErrorStageLabel(null);
      setCancelMessage(null);
      setJob(null);
      setStale(resultRef.current !== null);
      setOverlayRatios(null);
      setOverlayValidations(null);
      setRecomputeState("idle");

      try {
        const created = await startAnalyzeJob(file);
        jobIdRef.current = created.job_id;
        void pollJob(created.job_id, file);
      } catch (err) {
        jobIdRef.current = null;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Analyse starten mislukt.");
        setStale(false);
      }
    },
    [pollJob, setPdfFromBlob, stopPolling],
  );

  const cancelAnalysis = useCallback(async () => {
    const jobId = jobIdRef.current;
    stopPolling();
    jobIdRef.current = null;
    if (jobId) {
      try {
        await cancelAnalyzeJob(jobId);
      } catch {
        // Local cancel still applies.
      }
    }
    setJob((current) =>
      current
        ? { ...current, status: "canceled", result: null }
        : current,
    );
    if (resultRef.current) {
      setStatus("completed");
      setStale(false);
      setError(null);
      setCancelMessage(null);
    } else {
      setStatus("canceled");
      setCancelMessage("Analyse geannuleerd.");
      setError(null);
    }
  }, [stopPolling]);

  const retryAnalysis = useCallback(() => {
    if (pdfFile) void startAnalysis(pdfFile);
  }, [pdfFile, startAnalysis]);

  const runRecompute = useCallback(
    (analysis: AnalysisResult) => {
      if (recomputeTimerRef.current) {
        window.clearTimeout(recomputeTimerRef.current);
      }
      const gen = ++recomputeGenRef.current;
      setRecomputeState("updating");
      setRecomputeError(null);
      recomputeTimerRef.current = window.setTimeout(() => {
        void (async () => {
          try {
            const payload = await computeRatios({
              balance_assets: analysis.balance_assets,
              balance_liabilities: analysis.balance_liabilities,
              income_statement: analysis.income_statement,
            });
            if (recomputeGenRef.current !== gen) return;
            setOverlayRatios(payload.ratios);
            setOverlayValidations(payload.validations);
            setRecomputeState("idle");
            setResult((current) => {
              if (!current) return current;
              const next = {
                ...current,
                ratios: payload.ratios,
                validations: payload.validations,
              };
              if (pdfFile && contentHash) {
                void saveCachedAnalysis(next, pdfFile, pdfFile.name).catch(
                  () => undefined,
                );
              }
              return next;
            });
          } catch (err) {
            if (recomputeGenRef.current !== gen) return;
            setRecomputeState("failed");
            setRecomputeError(
              err instanceof Error ? err.message : "Herberekening mislukt.",
            );
          }
        })();
      }, RECOMPUTE_DEBOUNCE_MS);
    },
    [contentHash, pdfFile],
  );

  const refreshLiveRatios = useCallback(() => {
    if (status === "completed" && !stale && resultRef.current) {
      runRecompute(resultRef.current);
    }
  }, [runRecompute, stale, status]);

  const displayedRatios = overlayRatios ?? result?.ratios ?? [];
  const displayedValidations = overlayValidations ?? result?.validations ?? [];

  return {
    status,
    result,
    stale,
    pdfUrl,
    pdfFile,
    contentHash,
    job,
    error,
    errorDetail,
    errorStageLabel,
    cancelMessage,
    restoreReady,
    startAnalysis,
    cancelAnalysis,
    retryAnalysis,
    refreshLiveRatios,
    recomputeState,
    recomputeError,
    displayedRatios,
    displayedValidations,
  };
}
