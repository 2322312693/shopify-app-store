export const config = { maxDuration: 300 };
export { loader, action } from './app._index';
import { useFetcher, useLoaderData } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { Page, Card, BlockStack, InlineStack, Text, Button, Banner, Checkbox, Select, Badge, ProgressBar } from '@shopify/polaris';
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from '../services/upload-policy';

function Result({ item, products }) {
  const save = useFetcher();
  const [destination, setDestination] = useState(item.productId || products[0]?.id || '');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  async function download() {
    setDownloading(true); setError('');
    try {
      const response = await fetch(item.outputUrl, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a'); a.href = url; a.download = 'background-removed.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setError('Download failed. Open the image and save it from your browser.'); }
    finally { setDownloading(false); }
  }
  return <BlockStack gap="300">
    <img src={item.outputUrl} alt={`Background removed: ${item.name}`} style={{width:'100%',height:200,objectFit:'contain',background:'repeating-conic-gradient(#eee 0% 25%,white 0% 50%) 0 / 20px 20px'}} />
    <InlineStack gap="200"><Button onClick={download} loading={downloading}>Download PNG</Button><Button url={item.outputUrl} external>Open image</Button></InlineStack>
    {error && <Banner tone="warning">{error}</Banner>}
    {products.length > 0 && <save.Form method="post"><BlockStack gap="200">
      <input type="hidden" name="intent" value="add"/><input type="hidden" name="outputUrl" value={item.outputUrl}/>
      <Select label="Save to product" name="productId" options={products.map(p=>({label:p.title,value:p.id}))} value={destination} onChange={setDestination}/>
      <Button submit loading={save.state !== 'idle'} disabled={!destination || save.state !== 'idle'}>Add to product</Button>
    </BlockStack></save.Form>}
    {save.data && <Banner tone={save.data.ok?'success':'critical'}>{save.data.ok?'Added as a new product image.':save.data.error}</Banner>}
  </BlockStack>;
}

export default function BulkBackground() {
  const { products, usage, usageWarning } = useLoaderData();
  const processor = useFetcher();
  const [items, setItems] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [currentUsage, setCurrentUsage] = useState(usage);
  const flight = useRef(null);
  const previous = useRef(null);
  const previews = useRef([]);
  useEffect(()=>()=>previews.current.forEach(URL.revokeObjectURL),[]);
  useEffect(() => {
    if (processor.state !== 'idle') return;
    if (flight.current) {
      if (!processor.data || processor.data === previous.current) return;
      const id = flight.current; flight.current = null;
      const data = processor.data; previous.current = data;
      setItems(list=>list.map(item=>item.id===id?{...item,status:data.ok?'done':'failed',outputUrl:data.outputUrl,error:data.error || 'Request failed'}:item));
      if (data.usage) setCurrentUsage(data.usage);
      if (!data.ok && data.usage) setRunning(false);
      return;
    }
    if (!running) return;
    const next = items.find(item=>item.status === 'pending');
    if (!next) { setRunning(false); return; }
    flight.current = next.id; previous.current = processor.data;
    const form = new FormData(); form.set('intent','generate');form.set('cleanupMode','background');
    form.set('imageSource',next.file?'upload':'product');
    if(next.file)form.set('imageFile',next.file);
    else {form.set('productId',next.productId);form.set('sourceImageUrl',next.preview);}
    setItems(list=>list.map(item=>item.id===next.id?{...item,status:'processing'}:item));
    processor.submit(form,{method:'post',encType:'multipart/form-data'});
  },[processor.state,processor.data,running,items]);
  function upload(event) {
    const files=Array.from(event.target.files || []); event.target.value='';setError('');
    if(items.length+files.length>20){setError('Choose up to 20 images per batch.');return;}
    if(files.some(f=>!UPLOAD_TYPES.includes(f.type)||!f.size||f.size>MAX_UPLOAD_BYTES)){setError('Each image must be JPG, PNG or WebP, no larger than 3 MB.');return;}
    setItems(list=>[...list,...files.map(file=>{const preview=URL.createObjectURL(file);previews.current.push(preview);return {id:crypto.randomUUID(),file,preview,name:file.name,status:'pending'};})]);
  }
  function select(product,image,checked) {
    setError('');const id=product.id+image.id;
    if(checked && items.length>=20){setError('Choose up to 20 images per batch.');return;}
    setItems(list=>checked?[...list,{id,productId:product.id,preview:image.url,name:product.title,status:'pending'}]:list.filter(i=>i.id!==id));
  }
  const busy = items.some(i=>i.status==='processing');
  const completed=items.filter(i=>i.status==='done'||i.status==='failed').length;
  return <Page title="Bulk background remover" subtitle="Remove backgrounds from up to 20 product photos and export transparent PNGs." backAction={{content:'Image editor',url:'/app'}}>
    <BlockStack gap="400">
      <Banner>Each image uses one image from your existing plan. Failed processing is refunded. Keep this page open while the batch runs. Original product images are preserved.</Banner>
      {usageWarning && <Banner tone="warning">{usageWarning}</Banner>}
      {currentUsage && <Text as="p">{currentUsage.used} / {currentUsage.limit} images used</Text>}
      {error && <Banner tone="critical">{error}</Banner>}
      <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">1. Choose images</Text>
        <Text as="p">Upload images you own or are authorized to edit. Selected files are uploaded to our image storage and sent for processing when you start.</Text>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Upload images for background removal" disabled={running||busy} onChange={upload}/>
        <Text as="p" tone="subdued">JPG, PNG or WebP · 3 MB per image · {items.length}/20 selected</Text>
        <details><summary>Select Shopify product images</summary><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:16,marginTop:16,maxHeight:400,overflow:'auto'}}>
          {products.flatMap(product=>product.images.map(image=><div key={product.id+image.id}><img src={image.url} alt={product.title} style={{width:'100%',height:100,objectFit:'contain'}}/><Checkbox label={product.title} checked={items.some(i=>i.id===product.id+image.id)} disabled={running||busy} onChange={checked=>select(product,image,checked)}/></div>))}
        </div></details>
        <InlineStack gap="200"><Button variant="primary" disabled={running||busy||!items.some(i=>i.status==='pending')} onClick={()=>setRunning(true)}>Remove backgrounds</Button>
        {running && <Button onClick={()=>setRunning(false)}>Stop after current image</Button>}
        {!running&&!busy&&items.length>0&&<Button onClick={()=>{setItems([]);previews.current.forEach(URL.revokeObjectURL);previews.current=[];}}>Clear batch</Button>}
        </InlineStack>
        {items.length>0&&<><ProgressBar progress={completed/items.length*100}/><Text as="p">{completed} / {items.length} processed{busy?' · Processing one image…':''}</Text></>}
      </BlockStack></Card>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16}}>
      {items.map(item=><Card key={item.id}><BlockStack gap="300"><Text as="h3" variant="headingSm">{item.name}</Text><Badge tone={item.status==='done'?'success':item.status==='failed'?'critical':'info'}>{item.status}</Badge>
        {item.status==='done'?<Result item={item} products={products}/>:<img src={item.preview} alt={item.name} style={{width:'100%',height:160,objectFit:'contain'}}/>}
        {item.status==='failed'&&<><Banner tone="critical">{item.error}</Banner><Button disabled={running||busy} onClick={()=>setItems(list=>list.map(i=>i.id===item.id?{...i,status:'pending'}:i))}>Retry this image</Button></>}
      </BlockStack></Card>)}
      </div>
    </BlockStack>
  </Page>;
}
