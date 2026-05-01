import React, { useState, useCallback } from 'react'
import { Send, Bot, CheckCircle2, Circle, Loader2, XCircle, Table2 } from 'lucide-react'
import { AgentTask, AgentTaskResult, AgentStep } from '../types'
import { api } from '../lib/api'
import { createAgentSSE } from '../lib/sse'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'

const STEP_NAMES: AgentStep['name'][] = ['plan', 'generate', 'validate', 'execute', 'format']

function StepIndicator({ steps, currentStep }: { steps: AgentStep[]; currentStep: string | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 0' }}>
      {STEP_NAMES.map((name) => {
        const step = steps.find((s) => s.name === name)
        const status = step?.status ?? (currentStep === name ? 'running' : 'pending')
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {status === 'completed' ? (
              <CheckCircle2 size={16} style={{ color: '#16a34a', flexShrink: 0 }} />
            ) : status === 'running' ? (
              <Loader2 size={16} style={{ color: '#667eea', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            ) : status === 'failed' ? (
              <XCircle size={16} style={{ color: '#e53e3e', flexShrink: 0 }} />
            ) : (
              <Circle size={16} style={{ color: '#ddd', flexShrink: 0 }} />
            )}
            <span
              style={{
                fontSize: 13,
                color: status === 'completed' ? '#1a1a1a' : status === 'running' ? '#667eea' : status === 'failed' ? '#e53e3e' : '#bbb',
                fontWeight: status === 'running' ? 500 : 400,
                textTransform: 'capitalize',
              }}
            >
              {name}
            </span>
            {step?.detail && (
              <span style={{ fontSize: 11.5, color: '#aaa', marginLeft: 4 }}>— {step.detail}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ResultTable({ result }: { result: AgentTaskResult }) {
  if (!result.rows || !result.columns) return null

  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12.5,
        }}
      >
        <thead>
          <tr style={{ backgroundColor: '#f5f5f5' }}>
            {result.columns.map((col) => (
              <th
                key={col}
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: '#555',
                  borderBottom: '1px solid #e5e5e5',
                  whiteSpace: 'nowrap',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr
              key={i}
              style={{ borderBottom: '1px solid #f0f0f0' }}
            >
              {result.columns!.map((col) => (
                <td key={col} style={{ padding: '8px 12px', color: '#333' }}>
                  {String(row[col] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HistoryItem({ task }: { task: AgentTask }) {
  const statusVariants = {
    pending: 'warning' as const,
    running: 'blue' as const,
    completed: 'success' as const,
    failed: 'error' as const,
  }
  return (
    <div
      style={{
        padding: '12px 14px',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        backgroundColor: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: '#1a1a1a', flex: 1, marginRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.question}
        </span>
        <Badge variant={statusVariants[task.status]}>{task.status}</Badge>
      </div>
      <p style={{ fontSize: 11.5, color: '#aaa' }}>
        {new Date(task.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </p>
    </div>
  )
}

export default function AgentsPage() {
  const [question, setQuestion] = useState('')
  const [taskHistory, setTaskHistory] = useState<AgentTask[]>([])
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [result, setResult] = useState<AgentTaskResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    const q = question.trim()
    if (!q || isRunning) return

    setError(null)
    setSteps([])
    setResult(null)
    setCurrentStep('plan')
    setIsRunning(true)

    // Create task
    const { data, error: taskErr } = await api.post<{ task_id: string }>('/agents/tasks', {
      type: 'text_to_sql',
      question: q,
    })

    if (taskErr || !data) {
      setError(taskErr ?? 'Failed to create task')
      setIsRunning(false)
      return
    }

    const newTask: AgentTask = {
      task_id: data.task_id,
      type: 'text_to_sql',
      question: q,
      status: 'running',
      created_at: new Date().toISOString(),
    }
    setActiveTask(newTask)
    setTaskHistory((h) => [newTask, ...h])
    setQuestion('')

    // Stream progress
    const url = `/api/agents/tasks/${data.task_id}/stream`
    const cleanup = createAgentSSE(url, {
      onStep: (step) => {
        setCurrentStep(step.name)
        setSteps((prev) => {
          const existing = prev.findIndex((s) => s.name === step.name)
          const updated: AgentStep = {
            name: step.name as AgentStep['name'],
            status: step.status as AgentStep['status'],
            detail: step.detail,
          }
          if (existing >= 0) {
            const copy = [...prev]
            copy[existing] = updated
            return copy
          }
          return [...prev, updated]
        })
      },
      onResult: (data) => {
        setResult(data as AgentTaskResult)
        setTaskHistory((h) =>
          h.map((t) =>
            t.task_id === newTask.task_id ? { ...t, status: 'completed', result: data as AgentTaskResult } : t
          )
        )
      },
      onDone: () => {
        setIsRunning(false)
        setCurrentStep(null)
        cleanup()
      },
      onError: () => {
        setError('Stream connection error. The task may still be running.')
        setIsRunning(false)
        setCurrentStep(null)
        setTaskHistory((h) =>
          h.map((t) =>
            t.task_id === newTask.task_id ? { ...t, status: 'failed' } : t
          )
        )
        cleanup()
      },
    })
  }, [question, isRunning])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        fontFamily: "'DM Sans', sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '22px 28px 18px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: '#1a1a1a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bot size={16} style={{ color: 'white' }} />
            </div>
            <h1 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>Text-to-SQL Agent</h1>
          </div>
          <p style={{ fontSize: 12.5, color: '#888', paddingLeft: 42 }}>
            Ask questions in plain English and get SQL-powered answers from your data.
          </p>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {/* Query input */}
          <div
            style={{
              border: '1px solid #e5e5e5',
              borderRadius: 10,
              overflow: 'hidden',
              marginBottom: 24,
              backgroundColor: 'white',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}
          >
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your data... e.g. 'How many users signed up last month?'"
              disabled={isRunning}
              rows={3}
              style={{
                width: '100%',
                padding: '14px 16px',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontSize: 13.5,
                color: '#1a1a1a',
                fontFamily: "'DM Sans', sans-serif",
                lineHeight: 1.6,
                backgroundColor: 'transparent',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderTop: '1px solid #f0f0f0',
                backgroundColor: '#fafafa',
              }}
            >
              <span style={{ fontSize: 11.5, color: '#bbb' }}>
                Press Enter to submit · Shift+Enter for new line
              </span>
              <Button
                onClick={handleSubmit}
                disabled={!question.trim() || isRunning}
                loading={isRunning}
                size="sm"
              >
                <Send size={13} />
                {isRunning ? 'Running...' : 'Run query'}
              </Button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#fff5f5',
                border: '1px solid #fed7d7',
                borderRadius: 8,
                fontSize: 12.5,
                color: '#e53e3e',
                marginBottom: 20,
              }}
            >
              {error}
            </div>
          )}

          {/* Active task progress */}
          {activeTask && (
            <div
              style={{
                backgroundColor: 'white',
                border: '1px solid #ebebeb',
                borderRadius: 10,
                padding: '18px 20px',
                marginBottom: 20,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>
                Current task
              </h3>
              <p style={{ fontSize: 12.5, color: '#888', marginBottom: 12 }}>{activeTask.question}</p>

              {/* Steps */}
              <StepIndicator steps={steps} currentStep={currentStep} />

              {/* Result */}
              {result && (
                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 16,
                    borderTop: '1px solid #f0f0f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <CheckCircle2 size={14} style={{ color: '#16a34a' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>Answer</span>
                  </div>
                  <p style={{ fontSize: 13.5, color: '#333', lineHeight: 1.6, marginBottom: 10 }}>
                    {result.answer}
                  </p>

                  {result.sql && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                        Generated SQL
                      </p>
                      <pre
                        style={{
                          backgroundColor: '#1a1a1a',
                          color: '#a8ff78',
                          padding: '12px 14px',
                          borderRadius: 8,
                          fontSize: 12,
                          overflowX: 'auto',
                          lineHeight: 1.6,
                          fontFamily: 'monospace',
                        }}
                      >
                        {result.sql}
                      </pre>
                    </div>
                  )}

                  {result.rows && result.rows.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                        <Table2 size={13} style={{ color: '#888' }} />
                        <p style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                          Results ({result.rows.length} rows)
                        </p>
                      </div>
                      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
                        <ResultTable result={result} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Task history sidebar */}
      {taskHistory.length > 0 && (
        <div
          style={{
            width: 280,
            borderLeft: '1px solid #e5e5e5',
            backgroundColor: '#fafafa',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid #f0f0f0' }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Task History
            </p>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {taskHistory.map((task) => (
              <HistoryItem key={task.task_id} task={task} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
