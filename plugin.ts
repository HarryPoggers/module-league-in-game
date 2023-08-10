import type { PluginContext } from '@rcv-prod-toolkit/types'
import { InGameState } from './controller/InGameState'
import type { AllGameData } from './types/AllGameData'
import type { Config } from './types/Config'
import { FarsightData } from './types/FarsightData'
const fs = require("fs");

module.exports = async (ctx: PluginContext) => {
  const namespace = ctx.plugin.module.getName()

  const configRes = await ctx.LPTE.request({
    meta: {
      type: 'request',
      namespace: 'plugin-config',
      version: 1
    }
  })
  if (configRes === undefined) {
    ctx.log.warn('config could not be loaded')
  }
  let config: Config = Object.assign(
    {
      items: [],
      level: [],
      events: [],
      killfeed: false,
      ppTimer: false,
      showNicknames: false,
      delay: 0,
      scoreboard: {
        active: true,
        barons: true,
        heralds: true,
        score: true,
        standings: true,
        tags: true,
        tower: true
      }
    } as Config,
    configRes?.config
  )

  ctx.LPTE.on(namespace, 'set-settings', (e) => {
    config.items = e.items
    config.level = e.level
    config.events = e.events
    config.killfeed = e.killfeed
    config.ppTimer = e.ppTimer
    config.delay = e.delay
    config.showNicknames = e.showNicknames
    config.scoreboard = e.scoreboard

    ctx.LPTE.emit({
      meta: {
        type: 'set',
        namespace: 'plugin-config',
        version: 1
      },
      config
    })
  })

  ctx.LPTE.on(namespace, 'get-settings', (e) => {
    ctx.LPTE.emit({
      meta: {
        type: e.meta.reply!,
        namespace: 'reply',
        version: 1
      },
      ...config
    })
  })

  ctx.LPTE.emit({
    meta: {
      type: 'add-pages',
      namespace: 'ui',
      version: 1
    },
    pages: [
      {
        name: 'LoL: In-Game',
        frontend: 'frontend',
        id: `op-${namespace}`
      }
    ]
  })

  let inGameState: InGameState

  ctx.LPTE.on('module-league-static', 'static-loaded', async (e) => {
    const statics = e.constants

    const stateRes = await ctx.LPTE.request({
      meta: {
        type: 'request',
        namespace: 'module-league-state',
        version: 1
      }
    })
    const state = stateRes?.state

    ctx.LPTE.on('lcu', 'lcu-champ-select-create', () => {
      inGameState = new InGameState(namespace, ctx, config, state, statics)
    })

    ctx.LPTE.on(namespace, 'reset-game', () => {
      ctx.log.info('Resetting in game data')
      inGameState = new InGameState(namespace, ctx, config, state, statics)
    })

    ctx.LPTE.on(namespace, 'allgamedata', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      const data = e.data as AllGameData
      inGameState.handelData(data)
    })

    ctx.LPTE.on(namespace, 'farsight-data', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      const data = e.data as FarsightData
      inGameState.handelFarsightData(data)
    })

    ctx.LPTE.on(namespace, 'live-events', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      e.data.forEach((event: any) => {
        inGameState.handelEvent(event)
      })
    })

    ctx.LPTE.on(namespace, 'request', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      ctx.LPTE.emit({
        meta: {
          type: e.meta.reply as string,
          namespace: 'reply',
          version: 1
        },
        state: inGameState.gameState
      })
    })
  })

  ctx.LPTE.on(namespace, 'show-inhibs', (e) => {
    if (inGameState === undefined) return
    const side = parseInt(e.side) as any
    inGameState.gameState.showInhibitors = side
  })
  ctx.LPTE.on(namespace, 'show-leader-board', (e) => {
    if (inGameState === undefined) return
    const leaderboard = e.leaderboard
    inGameState.gameState.showLeaderBoard = leaderboard
  })
  ctx.LPTE.on(namespace, 'show-platings', (e) => {
    if (inGameState === undefined) return
    inGameState.gameState.platings.showPlatings = true
  })

  ctx.LPTE.on(namespace, 'hide-inhibs', (e) => {
    if (inGameState === undefined) return
    inGameState.gameState.showInhibitors = null
  })
  ctx.LPTE.on(namespace, 'hide-platings', (e) => {
    if (inGameState === undefined) return
    inGameState.gameState.platings.showPlatings = false
  })
  ctx.LPTE.on(namespace, 'hide-leader-board', (e) => {
    if (inGameState === undefined) return
    inGameState.gameState.showLeaderBoard = false
  })

  // Emit event that we're ready to operate
  ctx.LPTE.emit({
    meta: {
      type: 'plugin-status-change',
      namespace: 'lpt',
      version: 1
    },
    status: 'RUNNING'
  })

  function writeGameState() {
    let towersBlue, towersRed;
    for (const [teamId, team] of Object.entries(inGameState.gameState.towers)) {
        const value = teamId === '100' ? towersRed : towersBlue
        let newValue = 0
    
        for (const lane of Object.values(team)) {
          for (const alive of Object.values(lane)) {
            if (alive) continue
    
            newValue += 1
          }
        }
    
        if(teamId === '100')
            towersRed = newValue
        else
            towersBlue = newValue
      }


    const stateConv = [{
        time : convertSecsToTime(inGameState.gameState.gameTime),
        killsBlue : inGameState.gameState.kills[100],
        killsRed : inGameState.gameState.kills[200],
        goldBlue : calcK(inGameState.gameState.gold[100]),
        goldRed : calcK(inGameState.gameState.gold[200]),
        towersBlue : towersBlue,
        towersRed : towersRed,
    }];
    fs.writeFileSync('./gamestate.json', JSON.stringify(stateConv));
}

function calcK(amount: number) {
    switch (true) {
      case amount > 1000:
        return `${(amount / 1000).toFixed(1)} K`
      case amount < -1000:
        return `${(amount / 1000).toFixed(1)} K`
      default: 
        return amount.toFixed(0)
    }
}

function convertSecsToTime(secs: number) {
    const newSecs = Math.round(secs)
    const minutes = Math.floor(newSecs / 60)
    const seconds = newSecs % 60
    return `${('0' + minutes).slice(-2)}:${('0' + seconds).slice(-2)}`
  }
}
