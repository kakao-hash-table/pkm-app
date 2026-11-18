---
pkm_plugin: 1
id: upbit-quant
name: 업비트 퀀트
version: 0.1.5
author: pkm
permissions:
  bundled: [scripts/quant.mjs, scripts/engine.mjs, scripts/upbit.mjs, scripts/indicators.mjs, scripts/strategies.mjs]
  secrets:
    - { name: UPBIT_ACCESS_KEY, label: 업비트 Access key, hint: "업비트 › 마이페이지 › Open API 관리에서 발급해요. 권한은 자산조회·주문조회·주문하기만 켜고, 출금은 켜지 마세요. 이 컴퓨터의 공인 IP를 허용 IP에 넣어야 해요", url: "https://upbit.com/mypage/open_api_management" }
    - { name: UPBIT_SECRET_KEY, label: 업비트 Secret key, hint: "발급할 때 한 번만 보여요. 이 컴퓨터에만 저장하고 다른 곳으로 보내지 않아요", url: "https://upbit.com/mypage/open_api_management" }
settings:
  - { key: live, label: 실제 돈으로 사기, type: toggle, default: false, hint: "끄면 모의 거래예요(실제 시세로 사고판 것처럼 기록만 해요). 켜면 새로 사는 것을 실제로 주문해요. 이미 실제로 산 코인은 꺼도 매도 조건이 오면 실제로 팔아요" }
  - { key: budget, label: 굴릴 금액(원), default: "", placeholder: "2000000", hint: "적으면 복리로 굴려요. 이 금액에 지금까지 판 손익을 더한 돈을 '동시에 가질 수 있는 수'로 나눈 만큼씩 사요 — 이익이 나면 다음에 더 많이, 손실이 나면 더 적게 사요. 계좌에 돈이 더 있어도 이 돈 넘게는 쓰지 않아요(수수료 포함). 돈을 더 넣거나 뺐으면 이 금액을 고쳐 주세요. 비우면 아래 '한 번에 살 금액'대로 사요" }
  - { key: order_krw, label: 한 번에 살 금액(원), default: "10000", hint: "굴릴 금액을 비웠을 때만 써요. 신호 하나에 사는 금액이에요. 업비트 최소 주문이 5,000원이라, 값이 내려도 팔 수 있게 10,000원 이상을 권해요" }
  - { key: max_positions, label: 동시에 가질 수 있는 수, default: "5", hint: "이만큼 들고 있으면 더 사지 않아요. 굴릴 금액을 적었으면 그 돈을 이 수로 나눠서 사요. 비웠으면 한 번에 살 금액 × 이 수가 운용 한도예요(수익률의 기준)" }
  - { key: markets, label: 볼 코인, type: lines, default: "KRW-BTC\nKRW-ETH\nKRW-XRP\nKRW-ADA\nKRW-XLM", hint: "업비트 원화 마켓 코드를 한 줄에 하나, 20개까지. 기본값은 백테스트에서 전략을 고를 때 쓴 5종목이에요" }
  - { key: strategies, label: 켜 둔 전략, default: "or:keltner-breakout_period20_mult2.5+disparity", hint: "'전략' 탭의 [켜고 끄기]로 바뀌어요. 등록된 전략의 id를 쉼표로 적어요" }
  - { key: slippage, label: 매수 허용 슬리피지(%), default: "0.3", hint: "지금 값이 신호가 난 봉의 종가보다 이만큼 넘게 올랐으면 사지 않아요. 파는 것은 값과 상관없이 팔아요" }
  - { key: wait_sec, label: 지정가를 기다리는 시간(초), default: "20", hint: "지정가 주문이 이 시간 안에 다 체결되지 않으면 취소하고 시장가로 마저 해요(매수는 허용 슬리피지 안에서만)" }
---

미리 등록해 둔 전략으로 업비트 원화 마켓에서 코인을 자동으로 사고팔아요. 봉이 닫힐 때마다 볼 코인의 매수 조건과 들고 있는 코인의 매도 조건을 확인하고, 조건이 맞으면 지정가로 주문한 뒤 체결을 확인해요. 정한 시간 안에 다 체결되지 않으면 취소하고 시장가로 마저 해요.

전략은 지표 백테스터(junhosoft/stock-backtest)의 코인 리서치에서 표본 외 검증을 거친 것과 직접 골라 더한 것이 등록돼 있고, 켜고 끄기만 해요. 백테스트는 지난 숫자예요 — 앞으로의 수익을 보장하지 않고, 원금을 잃을 수 있어요.

처음에는 모의 거래예요. '준비와 설정'에서 계정 정보를 넣고 '실제 돈으로 사기'를 켠 뒤, 자동 시작을 켜면 실제로 주문해요. 신호가 뜨거나, 사거나 팔거나, 사지 않고 넘어가거나, 주문이 멈추면 휴대폰 알림으로 알려요. 출금은 하지 않고, 이 플러그인이 산 코인만 팔아요(직접 산 코인은 건드리지 않아요). 이 컴퓨터가 켜져 있고 pkm이 돌고 있을 때만 확인해요.
