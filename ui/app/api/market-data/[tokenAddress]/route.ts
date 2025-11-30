import { NextResponse } from 'next/server';
import { shouldUseMockBirdeye, mockBirdeye } from '@/lib/mock';

export async function POST(
  request: Request
) {
  try {
    const body = await request.json();
    const tokenAddress = body.tokenAddress;

    if (!tokenAddress) {
      return NextResponse.json(
        { success: false, data: null, error: 'Token address is required' },
        { status: 400 }
      );
    }

    // Use mock Birdeye if API key not available
    if (shouldUseMockBirdeye()) {
      const mockData = await mockBirdeye.getTokenMarketData(tokenAddress);
      console.log('Mock market data for', tokenAddress, ':', mockData);
      return NextResponse.json(mockData);
    }

    const response = await fetch(
      `https://public-api.birdeye.so/defi/v3/token/market-data?address=${tokenAddress}`,
      {
        headers: {
          'accept': 'application/json',
          'x-chain': 'solana',
          'X-API-KEY': process.env.BIRDEYE_API_KEY || ''
        }
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { success: false, data: null, error: 'Failed to fetch market data' },
        { status: response.status }
      );
    }

    const responseData = await response.json();
    // Birdeye v3 API returns { success: true, data: { ... } }
    const data = responseData.data || responseData;

    // Normalize Birdeye API response to match mock format
    return NextResponse.json({
      success: true,
      data: {
        price: data.price || 0,
        liquidity: data.liquidity || 0,
        total_supply: data.totalSupply || 0,
        circulating_supply: data.circulatingSupply || 0,
        fdv: data.fdv || 0,
        market_cap: data.marketCap || data.market_cap || 0,
        price_change_24h: data.priceChange24h || data.price_change_24h
      }
    });
  } catch (error) {
    console.error('Error fetching market data:', error);
    return NextResponse.json(
      { success: false, data: null, error: 'Failed to fetch market data' },
      { status: 500 }
    );
  }
}