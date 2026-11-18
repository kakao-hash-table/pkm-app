// 업비트 퀀트 — 전략 등록부. 손으로 고치지 않는다: pkm-app의 scripts/upbit-strategies.mjs가 지표 백테스터의 코인 리서치 결과에서 만든다.
// 전략 꼴은 백테스터의 strategy 형식 그대로(buy·sell 조건)이고, 혼합 전략은 mode(and·or)와 members를 가진다.
// grade·score·verdict·stats는 백테스트 결과다(stats는 선정에 안 쓴 종목의 표본 외 숫자). 앞으로의 수익을 보장하지 않는다.
// verdict가 added인 것은 사람이 직접 더한 전략이다(scripts/upbit-strategies.extra.json) — 표본 외 검증의 판정·점수가 없고, spec은 백테스터 주소의 combo= 값이다.
export const META = {
  "from": "stock-backtest research/report.coin.json · validation.coin.json",
  "generatedAt": "2026-11-13T17:20:34.167Z",
  "importedAt": "2026-11-14",
  "costs": {
    "feeBps": 5,
    "slippageBps": 5,
    "sellTaxBps": 0,
    "fill": "nextOpen"
  },
  "universe": [
    "KRW-BTC",
    "KRW-ETH",
    "KRW-XRP",
    "KRW-ADA",
    "KRW-XLM"
  ],
  "rules": {
    "pass": "기댓값>0 · 엣지>0 · 엣지 t≥2 · 점수≥60",
    "partial": "기댓값>0 · 엣지>0",
    "fail": "그 외",
    "na": "거래 10건 미만"
  },
  "min": 60
};

export const STRATEGIES = [
  {
    "id": "or:keltner-breakout_period20_mult2.5+disparity",
    "name": "켈트너 상단 돌파 / 중심선 이탈 [period=20, mult=2.5] ∨ 이격도 95 매수 / 100 매도",
    "kind": "combo",
    "interval": "1h",
    "grade": null,
    "score": null,
    "verdict": "added",
    "spec": "or:keltner-breakout(period=20,mult=2.5)+disparity",
    "stats": {
      "n": 1411,
      "expectancyPct": 0.422,
      "edgePct": 0.647,
      "edgeTStat": 4.146,
      "avgDaysHeld": 0.777,
      "avgMddPct": -42.466
    },
    "stats_from": "켈트너 파라미터 탐색",
    "source": "Keltner, C. (1960). How to Make Money in Commodities. / 국내 실무 지표(이격도). 일본 기술적 분석에서 유래, 국내 증권사 HTS 기본 지표.",
    "mode": "or",
    "members": [
      {
        "id": "keltner-breakout_period20_mult2.5",
        "name": "켈트너 상단 돌파 / 중심선 이탈 [period=20, mult=2.5]",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "price"
              },
              "op": "crossAbove",
              "right": {
                "type": "keltner",
                "period": 20,
                "mult": 2.5,
                "output": "upper"
              }
            }
          ],
          "sell": [
            {
              "left": {
                "type": "price"
              },
              "op": "crossBelow",
              "right": {
                "type": "keltner",
                "period": 20,
                "mult": 2.5,
                "output": "middle"
              }
            }
          ]
        }
      },
      {
        "id": "disparity",
        "name": "이격도 95 매수 / 100 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossBelow",
              "right": 95
            }
          ],
          "sell": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossAbove",
              "right": 100
            }
          ]
        }
      }
    ],
    "idea": "켈트너 상단 돌파 / 중심선 이탈 [period=20, mult=2.5] 또는 이격도 95 매수 / 100 매도 — 하나라도 보유 신호면 보유"
  },
  {
    "id": "and:bb-revert+disparity",
    "name": "볼린저 하단 매수 / 상단 매도 ∧ 이격도 95 매수 / 100 매도",
    "kind": "combo",
    "interval": "1h",
    "grade": "A",
    "score": 92.4,
    "verdict": "pass",
    "stats": {
      "n": 446,
      "expectancyPct": 1.035,
      "edgePct": 1.26,
      "edgeTStat": 3.595,
      "avgDaysHeld": 0.713,
      "avgMddPct": -31.52
    },
    "mode": "and",
    "members": [
      {
        "id": "bb-revert",
        "name": "볼린저 하단 매수 / 상단 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "bb",
                "period": 20,
                "mult": 2,
                "output": "percentB"
              },
              "op": "crossBelow",
              "right": 0
            }
          ],
          "sell": [
            {
              "left": {
                "type": "bb",
                "period": 20,
                "mult": 2,
                "output": "percentB"
              },
              "op": "crossAbove",
              "right": 1
            }
          ]
        }
      },
      {
        "id": "disparity",
        "name": "이격도 95 매수 / 100 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossBelow",
              "right": 95
            }
          ],
          "sell": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossAbove",
              "right": 100
            }
          ]
        }
      }
    ],
    "idea": "볼린저 하단 매수 / 상단 매도 그리고 이격도 95 매수 / 100 매도 — 모두 보유 신호일 때만 보유",
    "source": "Bollinger, J. (2001). Bollinger on Bollinger Bands. / 국내 실무 지표(이격도). 일본 기술적 분석에서 유래, 국내 증권사 HTS 기본 지표."
  },
  {
    "id": "and:ibs+disparity",
    "name": "IBS 0.2 매수 / 0.8 매도 ∧ 이격도 95 매수 / 100 매도",
    "kind": "combo",
    "interval": "1h",
    "grade": "A",
    "score": 91.9,
    "verdict": "pass",
    "stats": {
      "n": 1197,
      "expectancyPct": 0.429,
      "edgePct": 0.634,
      "edgeTStat": 5.239,
      "avgDaysHeld": 0.168,
      "avgMddPct": -22.33
    },
    "mode": "and",
    "members": [
      {
        "id": "ibs",
        "name": "IBS 0.2 매수 / 0.8 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "ibs"
              },
              "op": "<",
              "right": 0.2
            }
          ],
          "sell": [
            {
              "left": {
                "type": "ibs"
              },
              "op": ">",
              "right": 0.8
            }
          ]
        }
      },
      {
        "id": "disparity",
        "name": "이격도 95 매수 / 100 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossBelow",
              "right": 95
            }
          ],
          "sell": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossAbove",
              "right": 100
            }
          ]
        }
      }
    ],
    "idea": "IBS 0.2 매수 / 0.8 매도 그리고 이격도 95 매수 / 100 매도 — 모두 보유 신호일 때만 보유",
    "source": "Pagonidis, A. (2014). The IBS Effect: Mean Reversion in Equity ETFs. NAAIM Wagner Award. / 국내 실무 지표(이격도). 일본 기술적 분석에서 유래, 국내 증권사 HTS 기본 지표."
  },
  {
    "id": "and:rsi-30-70+disparity",
    "name": "RSI 30 매수 / 70 매도 ∧ 이격도 95 매수 / 100 매도",
    "kind": "combo",
    "interval": "1h",
    "grade": "A",
    "score": 91.4,
    "verdict": "pass",
    "stats": {
      "n": 397,
      "expectancyPct": 0.972,
      "edgePct": 1.199,
      "edgeTStat": 3.123,
      "avgDaysHeld": 0.729,
      "avgMddPct": -31.334
    },
    "mode": "and",
    "members": [
      {
        "id": "rsi-30-70",
        "name": "RSI 30 매수 / 70 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "rsi",
                "period": 14
              },
              "op": "crossBelow",
              "right": 30
            }
          ],
          "sell": [
            {
              "left": {
                "type": "rsi",
                "period": 14
              },
              "op": "crossAbove",
              "right": 70
            }
          ]
        }
      },
      {
        "id": "disparity",
        "name": "이격도 95 매수 / 100 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossBelow",
              "right": 95
            }
          ],
          "sell": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossAbove",
              "right": 100
            }
          ]
        }
      }
    ],
    "idea": "RSI 30 매수 / 70 매도 그리고 이격도 95 매수 / 100 매도 — 모두 보유 신호일 때만 보유",
    "source": "Wilder, J. W. (1978). New Concepts in Technical Trading Systems. / 국내 실무 지표(이격도). 일본 기술적 분석에서 유래, 국내 증권사 HTS 기본 지표."
  },
  {
    "id": "and:connors-rsi2+disparity",
    "name": "코너스 RSI(2) + 200선 필터 ∧ 이격도 95 매수 / 100 매도",
    "kind": "combo",
    "interval": "1h",
    "grade": "A",
    "score": 89.9,
    "verdict": "pass",
    "stats": {
      "n": 154,
      "expectancyPct": 0.61,
      "edgePct": 0.815,
      "edgeTStat": 2.607,
      "avgDaysHeld": 0.169,
      "avgMddPct": -10.36
    },
    "mode": "and",
    "members": [
      {
        "id": "connors-rsi2",
        "name": "코너스 RSI(2) + 200선 필터",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "price"
              },
              "op": ">",
              "right": {
                "type": "sma",
                "period": 200
              }
            },
            {
              "left": {
                "type": "rsi",
                "period": 2
              },
              "op": "<",
              "right": 10
            }
          ],
          "sell": [
            {
              "left": {
                "type": "price"
              },
              "op": ">",
              "right": {
                "type": "sma",
                "period": 5
              }
            }
          ]
        }
      },
      {
        "id": "disparity",
        "name": "이격도 95 매수 / 100 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossBelow",
              "right": 95
            }
          ],
          "sell": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossAbove",
              "right": 100
            }
          ]
        }
      }
    ],
    "idea": "코너스 RSI(2) + 200선 필터 그리고 이격도 95 매수 / 100 매도 — 모두 보유 신호일 때만 보유",
    "source": "Connors & Alvarez (2009). Short Term Trading Strategies That Work. / 국내 실무 지표(이격도). 일본 기술적 분석에서 유래, 국내 증권사 HTS 기본 지표."
  },
  {
    "id": "and:bb-revert-mid+disparity",
    "name": "볼린저 하단 매수 / 중심선 매도 ∧ 이격도 95 매수 / 100 매도",
    "kind": "combo",
    "interval": "1h",
    "grade": "A",
    "score": 89.7,
    "verdict": "pass",
    "stats": {
      "n": 439,
      "expectancyPct": 1.004,
      "edgePct": 1.23,
      "edgeTStat": 3.458,
      "avgDaysHeld": 0.716,
      "avgMddPct": -31.686
    },
    "mode": "and",
    "members": [
      {
        "id": "bb-revert-mid",
        "name": "볼린저 하단 매수 / 중심선 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "bb",
                "period": 20,
                "mult": 2,
                "output": "percentB"
              },
              "op": "crossBelow",
              "right": 0
            }
          ],
          "sell": [
            {
              "left": {
                "type": "bb",
                "period": 20,
                "mult": 2,
                "output": "percentB"
              },
              "op": "crossAbove",
              "right": 0.5
            }
          ]
        }
      },
      {
        "id": "disparity",
        "name": "이격도 95 매수 / 100 매도",
        "strategy": {
          "buy": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossBelow",
              "right": 95
            }
          ],
          "sell": [
            {
              "left": {
                "type": "disparity",
                "period": 20
              },
              "op": "crossAbove",
              "right": 100
            }
          ]
        }
      }
    ],
    "idea": "볼린저 하단 매수 / 중심선 매도 그리고 이격도 95 매수 / 100 매도 — 모두 보유 신호일 때만 보유",
    "source": "Bollinger, J. (2001). Bollinger on Bollinger Bands. / 국내 실무 지표(이격도). 일본 기술적 분석에서 유래, 국내 증권사 HTS 기본 지표."
  },
  {
    "id": "disparity",
    "name": "이격도 95 매수 / 100 매도",
    "kind": "single",
    "interval": "1h",
    "grade": "A",
    "score": 83.5,
    "verdict": "pass",
    "stats": {
      "n": 464,
      "expectancyPct": 1.024,
      "edgePct": 1.248,
      "edgeTStat": 3.618,
      "avgDaysHeld": 0.709,
      "avgMddPct": -32.112
    },
    "category": "역추세",
    "idea": "종가가 20선보다 5% 이상 아래(이격도<95)면 매수, 20선 회복이면 매도",
    "source": "국내 실무 지표(이격도). 일본 기술적 분석에서 유래, 국내 증권사 HTS 기본 지표.",
    "strategy": {
      "buy": [
        {
          "left": {
            "type": "disparity",
            "period": 20
          },
          "op": "crossBelow",
          "right": 95
        }
      ],
      "sell": [
        {
          "left": {
            "type": "disparity",
            "period": 20
          },
          "op": "crossAbove",
          "right": 100
        }
      ]
    }
  },
  {
    "id": "rsi2-extreme",
    "name": "RSI(2) 5 매수 / 70 매도",
    "kind": "single",
    "interval": "1h",
    "grade": "A",
    "score": 81.7,
    "verdict": "pass",
    "stats": {
      "n": 5008,
      "expectancyPct": 0.034,
      "edgePct": 0.24,
      "edgeTStat": 6.416,
      "avgDaysHeld": 0.254,
      "avgMddPct": -50.794
    },
    "category": "역추세",
    "idea": "추세 필터 없이 초단기 극단 과매도만 산다",
    "source": "Connors & Alvarez (2009). Short Term Trading Strategies That Work.",
    "strategy": {
      "buy": [
        {
          "left": {
            "type": "rsi",
            "period": 2
          },
          "op": "<",
          "right": 5
        }
      ],
      "sell": [
        {
          "left": {
            "type": "rsi",
            "period": 2
          },
          "op": ">",
          "right": 70
        }
      ]
    }
  },
  {
    "id": "bb-breakout",
    "name": "볼린저 상단 돌파 / 중심선 이탈",
    "kind": "single",
    "interval": "1d",
    "grade": "B",
    "score": 72.9,
    "verdict": "partial",
    "stats": {
      "n": 339,
      "expectancyPct": 9.982,
      "edgePct": 7.882,
      "edgeTStat": 2.81,
      "avgDaysHeld": 15.422,
      "avgMddPct": -56.08
    },
    "category": "추세",
    "idea": "상단 돌파를 추세 시작으로 보고 매수, 중심선 아래로 내려가면 매도",
    "source": "Bollinger, J. (2001). Bollinger on Bollinger Bands.",
    "strategy": {
      "buy": [
        {
          "left": {
            "type": "bb",
            "period": 20,
            "mult": 2,
            "output": "percentB"
          },
          "op": "crossAbove",
          "right": 1
        }
      ],
      "sell": [
        {
          "left": {
            "type": "bb",
            "period": 20,
            "mult": 2,
            "output": "percentB"
          },
          "op": "crossBelow",
          "right": 0.5
        }
      ]
    }
  },
  {
    "id": "cci-breakout",
    "name": "CCI +100 돌파 / 0 이탈",
    "kind": "single",
    "interval": "1d",
    "grade": "B",
    "score": 64.9,
    "verdict": "partial",
    "stats": {
      "n": 444,
      "expectancyPct": 8.362,
      "edgePct": 6.349,
      "edgeTStat": 2.852,
      "avgDaysHeld": 14.755,
      "avgMddPct": -63.086
    },
    "category": "추세",
    "idea": "Lambert 원안: +100 돌파를 새 추세로 보고 매수, 0 아래면 청산",
    "source": "Lambert, D. (1980). Commodity Channel Index: Tool for Trading Cyclic Trends. Commodities.",
    "strategy": {
      "buy": [
        {
          "left": {
            "type": "cci",
            "period": 20
          },
          "op": "crossAbove",
          "right": 100
        }
      ],
      "sell": [
        {
          "left": {
            "type": "cci",
            "period": 20
          },
          "op": "crossBelow",
          "right": 0
        }
      ]
    }
  },
  {
    "id": "obv-ma",
    "name": "OBV > OBV 20MA + 종가 > SMA20",
    "kind": "single",
    "interval": "1d",
    "grade": "B",
    "score": 60.8,
    "verdict": "partial",
    "stats": {
      "n": 583,
      "expectancyPct": 4.307,
      "edgePct": 3.01,
      "edgeTStat": 2.091,
      "avgDaysHeld": 10.021,
      "avgMddPct": -62.519
    },
    "category": "거래량",
    "idea": "거래량 누적(OBV)이 평균 위로 올라오고 가격도 20선 위면 매수",
    "source": "Granville, J. (1963). Granville's New Key to Stock Market Profits.",
    "strategy": {
      "buy": [
        {
          "left": {
            "type": "obv",
            "period": 20,
            "output": "obv"
          },
          "op": "crossAbove",
          "right": {
            "type": "obv",
            "period": 20,
            "output": "ma"
          }
        },
        {
          "left": {
            "type": "price"
          },
          "op": ">",
          "right": {
            "type": "sma",
            "period": 20
          }
        }
      ],
      "sell": [
        {
          "left": {
            "type": "obv",
            "period": 20,
            "output": "obv"
          },
          "op": "crossBelow",
          "right": {
            "type": "obv",
            "period": 20,
            "output": "ma"
          }
        }
      ]
    }
  }
];
