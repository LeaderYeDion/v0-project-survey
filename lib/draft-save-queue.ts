export interface DraftSaveJob {
  resourceId: string
  revision: number
}

interface Waiter {
  resolve: () => void
  reject: (error: unknown) => void
}

interface PendingSave<Job> {
  job: Job
  waiters: Waiter[]
}

export function createDraftSaveQueue<Job extends DraftSaveJob>(
  save: (job: Job) => Promise<void>,
) {
  let active = false
  let pending: PendingSave<Job> | null = null

  const discardPending = () => {
    if (!pending) return
    pending.waiters.forEach(waiter => waiter.resolve())
    pending = null
  }

  const drain = async () => {
    if (active) return
    active = true

    while (pending) {
      const current = pending
      pending = null
      try {
        await save(current.job)
        current.waiters.forEach(waiter => waiter.resolve())
      } catch (error) {
        current.waiters.forEach(waiter => waiter.reject(error))
      }
    }

    active = false
  }

  return {
    enqueue(job: Job): Promise<void> {
      return new Promise((resolve, reject) => {
        if (pending?.job.resourceId === job.resourceId) {
          pending.job = job
          pending.waiters.push({ resolve, reject })
        } else {
          discardPending()
          pending = { job, waiters: [{ resolve, reject }] }
        }
        void drain()
      })
    },

    discardPendingExcept(resourceId: string) {
      if (pending && pending.job.resourceId !== resourceId) {
        discardPending()
      }
    },
  }
}
