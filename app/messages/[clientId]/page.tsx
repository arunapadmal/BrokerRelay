'use client'
import {useParams} from 'next/navigation'
import {BrokerWorkspace} from '@/components/BrokerWorkspace'
export default function Messages(){const {clientId}=useParams<{clientId:string}>();return <BrokerWorkspace kind="messages" clientId={clientId}/> }
